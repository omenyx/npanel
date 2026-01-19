## Migration SSH Security (V1 Hardening)

- Rsync now enforces SSH host key verification.
- `StrictHostKeyChecking` is set to `yes`.
- Optional `knownHostsPath` can be provided in `sourceConfig` to point to a dedicated `known_hosts` file.
- If host key verification fails, the step is marked failed and a log entry with message `host_key_verification_failed` is written.
- The log includes hints:
  - Verify the `known_hosts` file contains the correct key, or
  - Add the source host key to the default `known_hosts` or provide `knownHostsPath`.
- Migrations must be run with a properly configured `known_hosts` setup to proceed.

