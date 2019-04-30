#!/bin/bash

##-Variables-##
args=$#
args_left=$args
to_vers="$1"
proj_root=$(dirname "$0")
proj_root=$(dirname "$proj_root")
pkgname=$(cat ${proj_root}/debian/control | grep '^Source: ' | sed 's/^Source: //')
version_files=( ./toddleglow.py )

##-Funcrions-##
function deb_gen_commit_range {
    new_vers="$1"
    first_commit=$(git rev-list --max-parents=0 HEAD)
    last_commit=$(git rev-parse HEAD)
    prev_tag="$first_commit"
    version_tags=( $(git tag -l 'v*' | sort -V) )
    for t in "${version_tags[@]}" ; do
        echo "$prev_tag..$t"
        prev_tag="$t"
    done
    echo "${prev_tag}..${last_commit}_${new_vers}"
}

function deb_gen_changelog {
    new_vers="$1"
    for r in $(deb_gen_commit_range "$new_vers" | tac) ; do
        r_split=( ${r//_/ } )
        range=${r_split[0]}
        nvers=${r_split[1]}
        range_split=( ${range//../ } )
        tag=${range_split[1]}
        vers=${nvers:-$tag}
        vers=${vers#v}
        change_snippet=$(
            echo -e "\n$pkgname (${vers}) unstable; urgency=low\n"
            git log --pretty=format:'%s%n%b%n  - Authored by: %an <%ae>%n' ${range} | sed '/^Merge branch.*/,/^ \+- Authored by:.*/d ; /^Merge pull request.*/,/^ \+- Authored by:.*/d  ; /^New release: .*/,/^ \+- Authored by:.*/d ; /^$/d ; s/^/  /'
            echo
            git log --pretty=format:'%s%n -- %an <%ae>  %aD %n%n' ${range} | sed '/^Merge branch.*/,/^ \+-- .*/d ; /^New release: .*/,/^ \+-- .*/d ; /^$/d ; /^[^ ]/d' | head -n 1
        )
        #This avoids a duplicate version with no changes
        if [ $(echo "$change_snippet" | sed '/^$/d' | wc -l) -gt 1 ] ; then
            echo "$change_snippet"
        fi
    done | sed '1d;s/^ +$//'
}

#Update version in files
for file in "${version_files[@]}"; do
    echo "Updating version string in: ${file}" >&2
    sed -i "s/^__version__ *= *.\+/__version__ = '${to_vers}'/" ${proj_root}/${file}
done

#Update setup.py
if [ -f "${proj_root}/setup.py" ] ; then
    echo "Updating setup.py" >&2
    sed -i "s/version=.\+/version='${to_vers}',/" ${proj_root}/setup.py
fi

deb_gen_changelog $to_vers
