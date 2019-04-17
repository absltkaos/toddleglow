#!/bin/bash

basedir="$(realpath "$(dirname "$0")")"
existing_tag=true
image_name='toddleglow:build-0.0.1'
proj_root="$(dirname "$basedir")"
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
cd - >/dev/null

#BUild a docker image
docker build -t "$image_name" -f - ${basedir} <<EOF
FROM ubuntu:xenial

RUN apt-get update && \
    apt-get install -y \
    debhelper \
    git \
    dh-python \
    dh-systemd \
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
