#!/bin/bash
# Swaps the installed .app bundle. `prepare` copies and verifies the replacement while the app
# still runs and checks it is signed as the bundle identifier given (`prepare <bundle> <new app> <work> <identifier>`);
# `install` waits for the app to exit, renames old -> backup and new -> installed, and restores the backup if anything
# fails (`install <bundle> "" <work> <pid>`). Arguments are passed verbatim, never interpolated.
set -euo pipefail
mode="$1"; bundle="$2"; source_app="$3"; work="$4"
replacement="$work/Replacement.app"
backup="$work/Previous.app"
exec >> "$work/install.log" 2>&1

if [ "$mode" = prepare ]; then
    /usr/bin/ditto "$source_app" "$replacement"
    /usr/bin/codesign --verify --deep --strict "$replacement"
    identifier="$5"
    [[ "$identifier" =~ ^[A-Za-z0-9.-]+$ ]] || exit 1
    # Ad-hoc releases have no Apple trust ticket; the release signature was verified before this
    # script ran. An installation signed with a certificate takes only a replacement signed with a
    # Developer ID certificate Apple issued to the same team, never an ad-hoc one, and Gatekeeper
    # must accept it. The display text names the bundle's path, which can hold any line, so an
    # installation counts as ad-hoc only when it says so and also fails Apple's anchor.
    installed_signature="$(/usr/bin/codesign --display --verbose=2 "$bundle" 2>&1)"
    if printf '%s\n' "$installed_signature" | /usr/bin/grep -qx 'Signature=adhoc' \
        && ! /usr/bin/codesign --verify -R "=anchor apple generic" "$bundle" 2>/dev/null; then
        /usr/bin/codesign --verify -R "=identifier \"$identifier\"" "$replacement"
        echo "Ad-hoc installation: replacement signature and identifier verified."
    else
        team="$(printf '%s\n' "$installed_signature" | /usr/bin/sed -n 's/^TeamIdentifier=//p')"
        if ! [[ "$team" =~ ^[A-Z0-9]{10}$ ]]; then
            echo "The installed app is signed without a team; refusing the update."
            exit 1
        fi
        # Developer ID Application: Apple's Developer ID intermediate, and the leaf's Developer ID extension.
        developer_id='anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] and certificate leaf[field.1.2.840.113635.100.6.1.13]'
        /usr/bin/codesign --verify -R "=identifier \"$identifier\" and $developer_id and certificate leaf[subject.OU] = \"$team\"" "$replacement"
        /usr/sbin/spctl --assess --type execute "$replacement"
        echo "Installation of team $team: replacement signature, identifier and team verified."
    fi
    exit 0
fi

[ "$mode" = install ] || exit 1
pid="$5"
for ((i=0; i<120; i++)); do
    kill -0 "$pid" 2>/dev/null || break
    /bin/sleep 0.5
done
if kill -0 "$pid" 2>/dev/null; then
    echo "Application did not exit; leaving the installed app untouched."
    exit 1
fi

# Starts the app at "$1". For a moment after an app exits, LaunchServices still lists it as running and answers
# `open` with error -600 instead of starting it (longer on a busy Mac), so one refusal is not the answer.
start_app() {
    for ((i=0; i<60; i++)); do
        /usr/bin/open "$1" && return 0
        /bin/sleep 0.5
    done
    return 1
}

moved_old=0
installed_new=0
rollback() {
    result=$?
    trap - EXIT
    if [ "$result" -ne 0 ] && [ "$moved_old" -eq 1 ]; then
        if [ "$installed_new" -eq 1 ]; then
            /bin/mv "$bundle" "$work/Failed.app" || exit "$result"
        fi
        /bin/mv "$backup" "$bundle" || exit "$result"
        echo "Update failed; restored the previous application."
        start_app "$bundle" || echo "The previous application could not be started."
    fi
    exit "$result"
}
trap rollback EXIT
if [ ! -d "$replacement" ] || [ -e "$backup" ]; then
    echo "Replacement missing or backup already exists; refusing installation."
    exit 1
fi
/bin/mv "$bundle" "$backup"
moved_old=1
/bin/mv "$replacement" "$bundle"
installed_new=1
start_app "$bundle"
echo "Update installed. Previous application retained at $backup"
