#!/bin/bash

last_change=$(git rev-parse HEAD)
last_release_tag=$(git tag -l 'v[0-9]*' | sort -rV | head -n 1)
if [ ! -z "$last_release_tag" ] ; then
    beg_range="${last_release_tag}.."
fi
changes_since_release=$(git log --pretty=format:'%s%n' ${beg_range}${last_change} | sed "/^Merge branch '.\+' into '.\+'/d ; /^$/d")
release_ver=''
basedir="$(realpath "$(dirname "$0")")"
existing_tag=true
image_name='toddleglow:build-0.0.1'
proj_root="$(dirname "$basedir")"
new_release=false
version="$1"

##- Functions -##
function check_tag {
    check_tag="$1"
    for tag in $(git tag -l 'v*' | sort -V) ; do
        if [ "$check_tag" == "$tag" ] ; then
            return 0
        fi
    done
    return 1
}

##--Main--##

if [ -z "$version" ] ; then
    echo "Missing a version number"
    exit 1
fi

cd $proj_root
git fetch --tags

if ! check_tag "v${version}" ; then
    echo "WARNING. Unknown version requested"
    echo "known versions:"
    for tag in $(git tag -l 'v*' | sort -V) ; do
        echo "  ${tag:1}"
    done
    read -p 'Is this a new release (If yes, then a new tag will be created)? (yes/no): ' resp
    if [ "${resp,,}" == 'yes' ] ; then
        new_release=true
        existing_tag=false
    else
        echo 'THIS WILL BUILD AN UNOFFICAL INTERIM BUILD'
        read -p 'Are you sure? (yes/no): ' resp
        if [ "${resp,,}" == 'yes' ] ; then
            existing_tag=false
        else
            echo "Aborting.."
            cd - >/dev/null
            exit 1
        fi
    fi
fi
cd - >/dev/null

if [ $(echo "$changes_since_release" | wc -l) -gt 0 ] ; then
    if [ "$new_release" == true ] ; then
        echo -e "Building a new release with the following changes included:\n----"
        echo "$changes_since_release" | nl -s '. '
        echo -e '----\n'
    fi
fi

#BUild a docker image
docker build -t "$image_name" -f - ${basedir} <<EOF
FROM ubuntu:xenial

RUN apt-get update && \
    apt-get install -y \
    debhelper \
    git \
    dh-python \
    dh-systemd \
    curl \
    jq \
    python-all \
    python-setuptools
EOF

docker run -it --rm -v "$proj_root:/code" "$image_name" bash -c "
    cp -a /code /build
    cd /build
    if [ $existing_tag == true ] ; then
        git checkout v${version}
    else
        cicd/gen_debian_changelog.sh $version > debian/changelog
    fi
    if ! dpkg-buildpackage -uc -us ; then
        echo 'Failed to build package'
        exit 1
    fi
    echo 'Build was successfull'
    mkdir -p /code/build
    mv ../*.deb ../*.changes ../*.dsc ../*_*.tar.gz /code/build
    echo 'Files built:'
    ls -l /code/build
"
build_rc=$?
if [ "$build_rc" -ne 0 ] ; then
    exit $?
fi
if [ "$new_release" == true ] ; then
    echo "Creating new release for github"
    docker run -it --rm -v "$proj_root:/code" "$image_name" /code/cicd/create_release.sh "${version}" "$changes_since_release"
    release_rc=$?
    exit $release_rc
fi
