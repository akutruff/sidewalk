#!/bin/bash
usage()
{
  echo "Usage: build.sh -t <tag> 
    -t | --tag  image tag for sidewalk. Should be <docker hub username>/sidewalk"
  exit 2
}

PARSED_ARGUMENTS=$(getopt -a -n run.sh -o t: --long tag: -- "$@")
VALID_ARGUMENTS=$?

if [[ "$VALID_ARGUMENTS" != "0" ]]; then
  usage
fi

eval set -- "$PARSED_ARGUMENTS"

while :
do
  case "$1" in
    -t | --tag)      TAG="$2"          ; shift 2 ;;
    # -- means the end of the arguments; drop this, and break out of the while loop
    --) shift; break ;;
  esac
done

if [[ -z "$TAG" ]]; then
    echo "$0: Tag not set."
    usage
    exit 4
fi

docker buildx inspect --builder amd64-arm64-builder &> /dev/null

if [[ $? -ne 0 ]]; then
    echo no builder found
    docker buildx create --name amd64-arm64-builder
    docker buildx inspect --builder amd64-arm64-builder --bootstrap
fi

docker buildx build --builder amd64-arm64-builder --platform linux/amd64,linux/arm64 -t $TAG --push .