#!/usr/bin/env bash

# Exit script if you try to use an uninitialized variable.
set -o nounset

# Exit script if a statement returns a non-true return value.
set -o errexit

# Use the error status of the first failure, rather than that of the last item in a pipeline.
set -o pipefail


ARCHIVE_FILE="go${GO_VERSION}.linux-amd64.tar.gz"
TARGET_PATH="/usr/local/go"

# check if already installed
if [ -e /usr/local/bin/go ]
then
  echo "Skipping installing Go: ${TARGET_PATH} already exists."
  exit 0
fi

# setup
mkdir ~/go-install-temp
cd ~/go-install-temp

# download and validate checksum
curl -k -s -o "${ARCHIVE_FILE}" "https://dl.google.com/go/${ARCHIVE_FILE}"
# echo "512103d7ad296467814a6e3f635631bd35574cab3369a97a323c9a585ccaa569  ${ARCHIVE_FILE}" > "${ARCHIVE_FILE}.sha256"
sha256sum -c "${ARCHIVE_FILE}.sha256"

# unpack and install
tar xf "${ARCHIVE_FILE}"
mv go "${TARGET_PATH}"
ln -s "${TARGET_PATH}/bin/go" /usr/local/bin/go

# cleanup
cd ~
rm -rf ~/go-install-temp
