# syntax=docker/dockerfile:1.7
# Nightly backup job (infra/backup/backup.sh) scheduled by supercronic.
FROM alpine:3.24.2

ARG SUPERCRONIC_VERSION=v0.2.49
ARG SUPERCRONIC_SHA256=a53ae236602c7338aba3fbaff40bda6300eae3b9fedb8261eb06cfe3724430c1

SHELL ["/bin/ash", "-eo", "pipefail", "-c"]
# Package versions come from the pinned Alpine release (exact apk pins break the
# build whenever Alpine ships a security fix); Trivy scans every release image.
# hadolint ignore=DL3018
RUN apk add --no-cache age bash curl jq postgresql17-client rclone tar tzdata \
 && curl -fsSLo /usr/local/bin/supercronic \
      "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-amd64" \
 && echo "${SUPERCRONIC_SHA256}  /usr/local/bin/supercronic" | sha256sum -c - \
 && chmod 0755 /usr/local/bin/supercronic \
 && addgroup -g 10001 -S backup \
 && adduser -u 10001 -S -D -G backup -h /home/backup backup \
 && install -d -o 10001 -g 10001 -m 0755 /textfile

COPY --chmod=0755 backup.sh restore.sh /opt/backup/
COPY --chmod=0644 verify.sql crontab /opt/backup/

# The crontab schedule is local time; backup object names are UTC. rclone is
# configured only from RCLONE_CONFIG_R2_* environment variables.
ENV TZ=America/New_York \
    RCLONE_CONFIG=/dev/null \
    PATH="/opt/backup:${PATH}"
USER 10001:10001
WORKDIR /home/backup
CMD ["supercronic", "-passthrough-logs", "/opt/backup/crontab"]
