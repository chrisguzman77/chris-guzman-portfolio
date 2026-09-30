# syntax=docker/dockerfile:1.7
FROM ghcr.io/actions/actions-runner:2.337.0

ARG COMPOSE_VERSION=v5.5.1
ARG COMPOSE_SHA256=db1889184726840f75c4f9c001048430d4f25b3be3cb084d3ddd762bc0aed576
ARG SOPS_VERSION=v3.13.3
ARG SOPS_SHA256=e5bec3346a873ae91d871550f3e698c1aad962aff462a080e40f25fde17fef6b
ARG AGE_VERSION=v1.3.2
ARG AGE_SHA256=cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10

USER 0:0
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
# The runner never runs npm (JS actions use the node binary directly). Dropping
# the bundled npm removes vulnerable transitive packages such as node-tar
# (CVE-2026-59873) that Trivy flags and upstream has not yet updated.
RUN curl -fsSLo /usr/local/lib/docker/cli-plugins/docker-compose \
      "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-x86_64" \
 && echo "${COMPOSE_SHA256}  /usr/local/lib/docker/cli-plugins/docker-compose" | sha256sum -c - \
 && chmod 0755 /usr/local/lib/docker/cli-plugins/docker-compose \
 && curl -fsSLo /usr/local/bin/sops \
      "https://github.com/getsops/sops/releases/download/${SOPS_VERSION}/sops-${SOPS_VERSION}.linux.amd64" \
 && echo "${SOPS_SHA256}  /usr/local/bin/sops" | sha256sum -c - \
 && chmod 0755 /usr/local/bin/sops \
 && curl -fsSLo /tmp/age.tgz \
      "https://github.com/FiloSottile/age/releases/download/${AGE_VERSION}/age-${AGE_VERSION}-linux-amd64.tar.gz" \
 && echo "${AGE_SHA256}  /tmp/age.tgz" | sha256sum -c - \
 && tar -xzf /tmp/age.tgz -C /usr/local/bin --strip-components=1 age/age age/age-keygen \
 && rm /tmp/age.tgz \
 && rm -rf /home/runner/externals/node*/lib/node_modules/npm \
           /home/runner/externals/node*/bin/npm \
           /home/runner/externals/node*/bin/npx

COPY --chmod=0755 entrypoint.sh /usr/local/bin/runner-entrypoint
USER 1001:1001
ENTRYPOINT ["/usr/local/bin/runner-entrypoint"]
