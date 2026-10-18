# Builder image for build-linux-arm64-local.sh: a pinned base plus the repo's pinned Node.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ARG EXTRA_PACKAGES=""
ARG NODE_ARCHIVE
ARG NODE_SHA256
RUN if [ -n "$EXTRA_PACKAGES" ]; then dnf install -y $EXTRA_PACKAGES && dnf clean all; fi
ENV PATH=/opt/node/bin:$PATH
RUN version="${NODE_ARCHIVE#node-v}" && version="${version%%-linux-*}" \
  && curl -fsSL -o /tmp/node.tar.gz "https://nodejs.org/dist/v${version}/${NODE_ARCHIVE}" \
  && echo "${NODE_SHA256}  /tmp/node.tar.gz" | sha256sum -c - \
  && mkdir -p /opt/node && tar -xzf /tmp/node.tar.gz -C /opt/node --strip-components=1 \
  && rm /tmp/node.tar.gz && corepack enable
