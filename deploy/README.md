# Local deployment baseline

This is a default-inactive application stack, not a verified deployment.
The database has no published port, belongs to an internal network, and is behind the explicit `database` Compose profile.
Web and scheduler definitions each have a separate explicit profile.
The one-shot migration definition is isolated in `compose.migration.yml` with its own profile and is absent from the normal stack.
A plain Compose invocation without profiles has no enabled services.
Profiles are not authorization controls: an explicit service name or profile can start a service.
Do not start any service until the master has reviewed and tested this stack and explicitly approved the operation.

## Activation blockers

The web application has money-related routes and its new fail-closed web/API control has not yet been independently verified.
The scheduler's money control also requires verification against every money-capable job.
Compose defaults `WEB_MONEY_ENABLED` to `false` and `VPS_MONEY_ENABLED` to `0`, and forces `PAYPAL_ENV` to `sandbox` in both services.
These settings are not proof that the application enforces those controls or cannot reach a live endpoint.
Stopping the scheduler alone does not disable web/API money paths.
Do not start the web or scheduler services until their fail-closed controls have been independently verified and the master explicitly approves startup.
Verify the actual deployment environment is PayPal sandbox before any activation; local configuration examples do not establish this.
The scheduler starts its jobs immediately, so merely starting it can trigger money operations.
Do not use fake end-to-end PayPal mode in a deployment.

Before activation, explicitly agree on the host topology, registry, immutable image digests, secret delivery, sandbox credentials, backup and restore ownership, monitoring, and any domain or proxy configuration.
Obtain separate approval for image publication, host changes, migration, application startup, public routing, and money-flow activation.
Nothing here authorizes changes to the shared host or its existing Caddy instance.

## Database prerequisites

Use only a dedicated local Docker context and a disposable or explicitly approved database volume.
Set a unique `TRANCHE_PROJECT_NAME` for each deployment; do not reuse another project's name, volume, or network.
The static `tranche-web` proxy DNS alias permits only one deployment using this service key on the shared network.
Before the first deployment, run `node deploy/preflight-new.mjs` with non-secret image references and identifiers after explicit approval to inspect the target Docker host.
The preflight uses the local `/var/run/docker.sock`, rejects existing matching project resources and conflicting proxy DNS names, and checks image digest syntax.
It is only for a new deployment and deliberately rejects existing resources, including those belonging to a previous Tranche deployment.
For recovery or upgrades, independently verify ownership and identity of each existing resource; never bypass a collision by adopting another project's data.
The preflight is not atomic with container creation and is not automatically enforced by Docker Compose.
Serialize provisioning and coordinate other users of the shared Docker host, recheck immediately before creation, and stop if ownership or a name is uncertain.
Select an approved PostgreSQL 18 image by immutable digest and provide it as `TRANCHE_POSTGRES_IMAGE`.
Before any CI-artifact activation, run `node deploy/validate-images.mjs` with all four approved registry manifest references; it rejects local IDs, missing, tagged-only, and malformed SHA-256 references.
For a separately approved local bootstrap only, `node deploy/validate-images.mjs --local` and `node deploy/preflight-new.mjs --local` also accept `sha256:<64 lowercase hex>` local image IDs.
A local image ID is an image configuration digest, not a registry manifest digest or a CI attestation.
All services use `pull_policy: never`; approved images must already be present on the host, and Compose will not fetch them.
These scripts check syntax and existing local names only, not image origin, signature, compatibility, or approval; direct Compose commands can bypass them.
Provide `TRANCHE_POSTGRES_PASSWORD_FILE` as an absolute path to a restricted local file outside the repository.
Docker Compose file-backed secrets are host files, not an encrypted secret store; protect the file and Docker host access.
Never put credentials in commands, version control, logs, or shell history.
The initial password is applied only when PostgreSQL initializes an empty data directory; changing the file does not rotate an existing database password.

Supply separate absolute paths outside the repository for `TRANCHE_WEB_ENV_FILE`, `TRANCHE_SCHEDULER_ENV_FILE`, and `TRANCHE_MIGRATION_ENV_FILE`.
Each is a runtime-only Node environment file mounted as a file-backed Compose secret, never passed as a build argument.
Local Compose file-backed secrets are bind mounts: `uid`, `gid`, and `mode` settings in a Compose secret do not change host file ownership or permissions.
For each application image, confirm the container's actual non-root UID and GID and the Docker daemon's user namespace mapping before provisioning its file.
Have the host administrator make each file readable only by its mapped service identity, for example a mapped owner with mode `0400` or a narrowly scoped read ACL, and grant only the necessary directory traversal permissions.
Account for rootless Docker, user namespace remapping, SELinux labels, and the PostgreSQL image's distinct startup identity; test access with non-secret fixtures on an isolated host before using real credentials.
Never make secret files world-readable or share a broad group merely to make a mount work.
Provision only the credentials each service needs and verify that unrelated host users and containers cannot read them.
Compose environment settings take precedence over Node environment file values, so the secret files cannot enable the money switches or override the forced sandbox setting.
The migration file needs a private `DATABASE_URL`; neither the file contents nor the connection string should appear in commands or logs.
The migration image relies on Corepack's `/usr/local/bin/pnpm` entry point and the provided image must be tested before use.
Database startup does not run migrations; the migration overlay and profile are for an explicitly approved one-shot operation only.
Never include the migration overlay in a general `up` command or use an all-profiles startup.
A future operator must use the reviewed overlay with `run --rm --no-deps migration` only after the database is ready and the backup and migration gates below are complete.

Run `node deploy/check-compose.mjs` to inspect the configuration with non-secret placeholders and without starting containers.
The check passes an explicit empty env file and a minimal subprocess environment so Compose does not automatically read a project `.env` file or inherit credentials.
This inspection does not establish that an image, password file, or database is safe or available.
Starting even the database requires an explicit `database` profile and separate approval.
All image and password-file inputs must be supplied even when their profiles are inactive because Compose interpolates the entire file.
Never pass credentials as those input values; the password input is a path only.

## Network and proxy requirements

The scaffold does not configure a proxy or activate an application listener.
The web definition joins the private database network and the existing external Docker network named `proxy`, without publishing a host port.
Compose assigns the distinctive service-name alias `tranche-web` and a project-specific container name, not the generic alias `web`.
The preflight checks these names against existing proxy-network containers, but other processes can race the check.
Never publish PostgreSQL's port or bind ports 80 or 443.
The internal database network isolates PostgreSQL from external routing, but the Docker host and any container attached to that network can still reach it.
Web is dual-homed: the shared proxy network may provide internet egress as well as ingress from peer containers, depending on host configuration.
The scheduler has a separate non-internal egress network, while the migration service has only the database network.
The internal database network therefore does not block web or scheduler access to external providers; any required egress restrictions need separate host-level controls.
Other containers on the shared proxy network can reach the web service, so that network is not an authentication boundary.
Confirm the existing network and service name are unambiguous before activation.
The supplied inspection reports that the existing Caddy container imports `/etc/caddy/sites` from host `/srv/proxy/sites`; this has not been independently verified here.
Once a hostname is approved, create only an application-specific site include, verify the include mapping and validate the complete Caddy configuration before a separately approved reload.
Preserve the previous include and configuration so an invalid configuration or failed health check can be rolled back without disturbing other sites.
Do not change shared Caddy configuration, DNS, firewall, or host ports without explicit approval.

## Resource limits

The provisional default limits are web 0.5 CPU, 512 MiB and 128 PIDs; scheduler 1 CPU, 768 MiB and 256 PIDs; PostgreSQL 0.75 CPU, 512 MiB and 128 PIDs; and one-shot migration 0.5 CPU, 384 MiB and 96 PIDs.
Each service has `TRANCHE_<SERVICE>_CPUS`, `TRANCHE_<SERVICE>_MEMORY`, and `TRANCHE_<SERVICE>_PIDS` overrides, with `POSTGRES`, `WEB`, `SCHEDULER`, and `MIGRATION` as service names.
Memory and memory-plus-swap limits use the same value, requesting no container swap where the host supports enforcement.
These are ceilings, not reservations: the normal three-service stack can consume up to 1.75 GiB and 2.25 CPUs before Docker, Caddy, the kernel, backups, and other host services; migration must run with writers stopped.
Confirm host headroom, cgroup and swap-limit enforcement, OOM and CPU-throttling alerts, and realistic load on an isolated environment before activation.
Chromium may exceed the scheduler cap or PID limit, and small PostgreSQL and web limits may reduce throughput or cause OOM failures.
Do not increase caps without assessing total shared-host capacity and obtaining approval; the configuration check verifies defaults, not host capacity or override safety.

## Scheduler supervision

The scheduler service has a 45-second stop grace period and an init process, but these do not enforce single-supervisor operation.
Before enabling it, choose one supervisor for exactly one scheduler instance and serialize deploys and restarts with an operator-controlled lock.
Stop the old supervisor and wait for its entire service cgroup to become empty before starting a replacement; a systemd unit should use `KillMode=control-group` and an appropriate stop timeout.
If using containers, stop and remove the entire old scheduler container, confirm its cgroup and all descendants have exited, and prevent an independent restart policy or supervisor from starting another instance.
All services use `restart: no`; crashes or host reboots do not automatically restore service, so operators must alert and recover them deliberately.
After confirming database integrity and readiness, restore web service only after reviewing the incident and deployment identity.
For scheduler crash, timeout, host reboot, or deployment, hold the deployment lock, disable competing supervisors, stop and remove the old scheduler container, and verify its entire cgroup and descendants are gone before starting a single replacement.
Do not use a blind `docker restart`, an automatic restart policy, or a second supervisor for the scheduler.
Do not start a replacement if cleanup, cgroup inspection, or confirmation fails; alert an operator and keep scheduled money flows stopped.
Test normal stop, forced termination, supervisor crash, host restart, lock loss, and orphaned descendants before activation.
Database advisory locks are not external-effect fencing: a child or in-flight PayPal request may outlive lock loss, so cgroup cleanup and idempotency do not guarantee exactly-once external effects.
Investigate and reconcile ambiguous outcomes before retrying.

## CI and release promotion

The CI workflow validates the scaffold and runs the existing checks before building the web, scheduler and migration image targets from the same checked-out GitHub revision.
It smoke-tests the local web image and inspects the local scheduler and migration image contents by image ID in network-isolated containers, without publishing or deploying them.
These checks do not exercise database integration, application money controls, scheduler job execution, or migrations.
The scheduler and migration image checks depend on `Dockerfile.runtime` and its output paths being completed and verified by the packaging worker.
Uncommitted work cannot be a verified GitHub CI artifact and must never be labeled as an exact clean commit or as same-SHA CI verified.
For any separately approved local-source deployment, first create and audit an immutable, secret-free source snapshot containing all relevant tracked and untracked build inputs, including the Dockerfile-specific ignore rules.
Compute and record a cryptographic content digest of that exact snapshot, the build configuration and resulting image IDs and digests, and build only from that snapshot.
A commit SHA can be recorded as context but does not identify the uncommitted source snapshot.
This process does not substitute for CI verification or authorize a deployment.
If private transfer is separately approved, save only the reviewed local images, record the archive checksum and each image configuration ID on the source host, and transfer the archive over a pinned-host-key channel.
Verify the archive checksum before loading it on the destination and verify every loaded image ID matches the approved source ID before any start.
Use local image IDs in the `--local` validation mode; do not call them registry digests or same-SHA CI artifacts.
A Compose configuration parse accepts this syntax, but actual load and startup by image ID remain untested and must be checked on an isolated host before use.
Keep the previous approved images and schema-compatible recovery procedure available; never prune shared images, caches, volumes, or other projects during cleanup.
Remote CI/CD activation requires a later approved commit and push.

Do not build on the shared VPS by default.
Use a separately approved isolated builder with verified CPU, memory, swap and disk limits for the entire BuildKit worker, not just build-step flags, plus capacity monitoring and an abort threshold.
A VPS-local builder is an exception only after its owner confirms those limits, available headroom, and non-disruption of existing services.
Build solely from the audited, secret-free immutable snapshot and record its content digest and exact build arguments; clean up only resources created by that build after confirmation.

An approved registry and verified scheduler and migration images are not yet available, so this scaffold does not implement image publication, release approval enforcement, or deployment automation.
Before adding promotion, build each required image once from the same approved commit and configuration, test those exact images, and record registry manifest digests together with the source SHA and test results.
A future protected release environment must independently approve the specific SHA, digest set, configuration, and target before publication or promotion; never rebuild images after approval.
Verify pulled manifest digests match the approved record, and reject mutable tags, missing approvals, incompatible migrations, stale releases, and concurrent deployments.
Approval records and image metadata must be authenticated by the CI platform, not merely asserted by local variables or editable files.
No such approval or digest-enforcement mechanism is implemented here, and these instructions are not a deployment gate.

A future release workflow should accept only a completed successful trusted-branch CI run and verify its exact full commit SHA, workflow identity, event, and artifact provenance before deployment.
Untrusted pull requests must never receive registry write access, deployment credentials, protected environment access, or host access.
The trusted build must retain the exact tested image artifacts for protected promotion rather than rebuilding them in the release job.
Use a protected GitHub environment with required reviewers and deployment concurrency controls, then publish and promote only the approved registry manifest digests.
Pin the SSH host key out of band and use a dedicated forced-command identity restricted to one reviewed release entry point.
Docker socket access is effectively host-root access; do not call the identity least-privilege merely because it is a separate Unix account.
A narrowly scoped, independently reviewed privileged broker is required if the release operation needs Docker control.
The host release entry point must serialize operations, verify artifact and approval identity, force sandbox and money-off settings, and refuse to proceed without verified backups, migration compatibility, and scheduler cgroup cleanup.
The registry, artifact retention, protected environment, SSH identity, broker, backup evidence, and host release entry point have not been implemented or provisioned.

## Migrations and rollback

Before any migration, separately approve the operation, stop and verify all writers and scheduler descendants, and serialize the deployment.
Take an encrypted off-host backup and verify a restore using an isolated database; agree on recovery point and recovery time objectives before relying on it.
Run the migration once from the verified artifact matching the approved source revision, recording the migration version and immutable web and scheduler image digests.
Use backward-compatible expand/contract changes so the previous application version remains compatible during a rollback.
If migration or verification fails, keep application and scheduler services stopped and investigate before proceeding.

Roll back application images only to previously verified digests and only after confirming schema compatibility.
Restoring a database can discard all changes since the backup and cannot reverse PayPal side effects.
For an uncertain external operation, keep money flows disabled, reconcile with PayPal sandbox, and escalate rather than blindly retrying or restoring.
Do not delete volumes as a rollback procedure.

## Readiness and alerts

Before activation, define non-secret web readiness checks, scheduler success heartbeats, and alerts for missing heartbeats, failed jobs, stuck inbox/outbox work, reconciliation drift, failed backups, and disk pressure.
A running process or successful database connection alone does not prove money processing is healthy.
Choose and approve monitoring and alert delivery separately.
