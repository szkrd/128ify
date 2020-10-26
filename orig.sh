#!/usr/bin/env bash
read -p "This will RECURSIVELY process all music files and downgrade them; are you sure? " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  [[ "$0" = "$BASH_SOURCE" ]] && exit 1 || return 1
fi
shopt -s nullglob
# recursively find all music files and then convert them one by one to 128k mp3
find . -type f -iname "*.mp3" -o -iname "*.flac"  -o -iname "*.mpc"  -o -iname "*.ogg" | while read file; do
  cd "$(dirname "${file}")"
  file="$(basename "${file}")"
  # was a mac hidden file, remove it
  if [ "$(echo "${file}" | grep '^\._' | wc -l)" -gt 0 ]; then
    rm "${file}"
    cd - > /dev/null
    continue
  fi
  # step 1: convert
  # ---
  BITRATE=$(ffprobe "${file}" |& grep -Eo 'bitrate: [0-9]+' | cut -d' ' -f2)
  RENAMEFROM="${file}"
  if [ "$(echo "${file}" | grep '.128.mp3' | wc -l)" -gt 0 ]; then
    echo "[${BITRATE}] [${file}] - skipping (ends with 128.mp3)"
  else
    # file is not blacklisted by extension
    if [ "${BITRATE}" -gt 128 ]; then
      echo "[${BITRATE}] [${file}] - converting"
      # dev null is needed! (https://unix.stackexchange.com/a/36411)
      # < /dev/null ffmpeg -i "${file}" -acodec libmp3lame -ac 2 -ab 128k -ar 44100 "${file}.128.mp3"
      < /dev/null ffmpeg -i "${file}" -loglevel -8 -map 0:a:0 -b:a 128k "${file}.128.mp3"
      RESULT=$?
      if [ $RESULT -eq 0 ]; then
        rm "${file}"
        RENAMEFROM="${file}.128.mp3"
      else
        echo "-> mp3 downgrade failed"
      fi
    else
      echo "[${BITRATE}] [${file}] - skipping (already low kbps)"
      mv "${file}" "${file}.128.mp3"
      RENAMEFROM="${file}.128.mp3"
    fi
  fi
  # step 2: cleanup name(s), works with or without the processing
  # ---
  NEWNAME="$(echo "${RENAMEFROM}" | tr '[A-Z]' '[a-z]' | sed 's/ - / /g' | sed 's/.\(mp3\|flac\|ogg\|mpc\).128.mp3$/.128.mp3/')"
  if [ ! -f "${NEWNAME}" ] && [ -f "${RENAMEFROM}" ]; then mv "${RENAMEFROM}" "${NEWNAME}"; fi
  # ---
  cd - > /dev/null
done
