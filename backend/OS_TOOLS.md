# System tools required for hosting operations

- id
- useradd
- usermod
- userdel
- nginx
- php-fpm or php-fpm versioned binary
- mysql client
- mysqladmin
- rndc for BIND
- pdnsutil for PowerDNS

# Common packages by distro family

- RHEL or CentOS
  - bind
  - bind-utils
  - nginx
  - php-fpm
  - mysql-server or mariadb-server
- Debian or Ubuntu
  - bind9
  - bind9utils
  - nginx
  - php-fpm
  - mysql-server or mariadb-server

# Manual verification steps

- Check BIND
  - rndc status
- Check PowerDNS
  - pdnsutil list-all-zones
- Check nginx
  - nginx -t
- Check php-fpm
  - php-fpm -t
- Check MySQL
  - mysqladmin ping

