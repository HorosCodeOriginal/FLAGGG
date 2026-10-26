FROM openresty/openresty:1.25.3.2-jammy

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY nginx.conf /usr/local/openresty/nginx/conf/nginx.conf
COPY lua/ /usr/local/openresty/nginx/lua/
COPY entrypoint.sh /entrypoint.sh
COPY healthcheck.sh /healthcheck.sh

RUN chmod +x /entrypoint.sh /healthcheck.sh \
    && mkdir -p /var/lib/fr-gateway-counter /var/log/nginx

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD /healthcheck.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["/usr/local/openresty/bin/openresty", "-g", "daemon off;"]
