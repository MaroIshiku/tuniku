# Compose Assistant

Use **Create Gluetun configuration** to prepare an add-on beside the running Tuniku stack. Choose the provider and protocol, enter its required credentials, select supported servers if needed, and generate guidance. Existing-stack tasks produce fragments to merge into the original stack; review tasks produce a redacted copy for comparison. No generated result proves that a container has been deployed.

## Guided setup

**Your VPN setup** groups the main flow into **Set up VPN → Connect application → Verify**. Preparing configuration does not complete deployment. The application step prepares a routing fragment for the same Compose project; retain the original volumes/download paths and review separate-project migrations explicitly. VPN/container replacement can interrupt dependent applications. Expert tasks and the optional managed change-plan/confirmation flow remain available below.

The verification step refreshes actual Control Server observations and links to connection settings and application ports. Only a current successful observation for the selected instance shows its VPN process/public IP/time; stale, failed or old observations require another check. These values do not establish application routing or DNS/IPv6 leak prevention. Follow the application-specific verification steps before relying on the route.

Internal navigation retains the current step and inputs. Saved redacted drafts reopen the VPN/application task for review with credentials cleared; successful runtime checks are not restored from a draft. A fresh check is always required after reopening or redeployment.

## Use the setup connection

After generating valid new-setup guidance, **Use setup connection** opens a review dialog. Confirmation replaces unsaved connection inputs in Settings with the proposed `http://gluetun:8000` URL, authentication mode and only its Control Server credentials. VPN credentials never transfer. Adjust the URL for the actual deployed stack before testing. Confirmation does not test, save, deploy or change the existing connection.

Review the fields, choose **Store credential encrypted** if desired (off by default for transferred inputs), then use **Test connection** and **Save** explicitly. Testing alone does not save. A successful test confirms Control Server reachability/authentication; it does not verify the VPN handshake or application route.

Transferred credential fields clear when Settings closes or within 15 minutes of transfer, with focus/visibility expiry checks when the tab returns. Late test responses cannot restore an accepted result for cleared inputs. Cleanup preserves server credentials that were explicitly saved; use the separate credential-delete action to clear server access. The temporary parent handoff object is discarded after consumption, and browser sign-out/expiry removes the session UI. Browser suspension can delay cleanup; this is not a guarantee of physical memory erasure. No browser-storage persistence is introduced.

## Validation evidence

Server suggestions retain the catalog's country/region/city/server relationships and narrow to the current selection. Changing countries clears region, city, server-name and hostname selections; region changes clear city/name/hostname; city changes clear name/hostname; name changes clear hostname. A status message announces cleared selections. Category and ISP preferences remain and are validated together with geography. Unchanged values do not clear children. Required credentials and other settings are preserved. Choose the broader filters first, then compatible narrower suggestions; contradictory combinations still fail server-side validation.

Every result separates five checks:

- **YAML syntax:** safe parsing, unique keys and bounded aliases.
- **Provider inputs:** required fields, allowed provider values and key/certificate formats. This checks local input; no provider account login or VPN handshake is attempted.
- **Compose structure:** bounded service, port and reference checks. Fragments need a complete merged stack before deployment.
- **Docker Compose config:** not run by generation. Run it locally in the real deployment directory with the intended environment and files. Its output can contain secrets.
- **VPN and application runtime:** not run by generation. Deploy, test Control Server authentication, and check the VPN handshake, application public IP, DNS and IPv6 behavior.

A passed syntax check does not establish startup, account validity or leak prevention. Redacted output is not deployment-ready. Invalid pasted source is omitted without echoing secret-bearing parser lines; the evidence still describes the original input rather than the redacted replacement.

## Environment sources

Generated optional-env packages use env_file as their single configuration source. Existing stacks may combine env_file with environment; the latter takes precedence even for empty values. Review warns about this combination and unresolved interpolation without reading arbitrary host files. Duplicate list-form environment keys are rejected to avoid ambiguous intent. Review the complete resolved stack locally and retain one authoritative value per setting. Relative file paths refer to the deployment directory, not the browser or the Tuniku container. Recreate affected containers after changing environment inputs.

The rules follow the [Docker Compose service reference](https://docs.docker.com/reference/compose-file/services/). Tuniku's bounded checks do not implement the entire Compose specification or resolve external files.

## Reopening saved drafts

Select **Save a redacted draft**, optionally enter a title, and generate guidance. **Saved drafts** lists metadata in pages of fifty; **Open** reloads supported settings for editing. Opening never applies Docker changes or replaces the current connection. Replacing current edited inputs requires confirmation. The old generated output is not replayed as current guidance. Credentials, pasted Compose and secret-output consent are cleared; re-enter the required material and review before generating again. Recognized legacy numeric port strings are supported; unreadable or unsupported records remain untouched and show an error. Saving edits creates another redacted record and preserves the original.

Assistant inputs stay in memory in this tab across internal navigation. They are never persisted in localStorage/sessionStorage. Supported browsers warn before unloading edited inputs, and sign-out explains their removal. A browser crash, mobile tab eviction or a browser that omits unload prompts can still lose unsaved input. Save a redacted draft to retain non-secret settings; keep credentials in your own protected storage.

Validation errors stay beside the relevant field with a corrective next step. The field exposes its invalid state and error description to assistive technology. Correcting a field clears its own error; changing the task or provider clears errors for replaced fields. Connection Save and Test failures remain in Settings until the next attempt, and a failed test identifies URL/network or authentication checks. Rejected URL validation never reflects URL credentials.

**Clear sensitive data** removes credential fields, pasted Compose, WireGuard import source, generated output and secret consent while retaining non-secret settings and saved drafts. Credential-bearing input expires after 15 minutes without editing the form; secret-bearing output expires within 15 minutes of generation. Expiry also checks the input deadline when the tab becomes visible or receives focus. Cleanup invalidates pending generation responses, so a late response cannot restore cleared output. Each generation consumes secret consent, including failures. Browser timers can be delayed while suspended; this is best-effort UI cleanup, not guaranteed memory erasure. Saved connection credentials and Docker are unaffected.


## Port conflict scope

Pasted Compose conflicts account for bind addresses, normalized IPv6/IPv4-mapped addresses, TCP/UDP and bounded port ranges without expanding every port. Local notes allow different specific addresses or protocols; equivalent addresses and wildcard overlaps are flagged as documentation conflicts, not evidence of runtime publication.

When generating an application-port proposal for a saved connection, Tuniku requests fresh read-only Docker metadata and checks the selected Gluetun configuration only after its direct Control API address is associated with that container. A conflicting address/protocol/host port mapped to a different target requires correction; an unchanged existing mapping remains valid. The validation list states the observed time and Docker state. Unavailable or unrelated observations remain not checked.

The bounded manager additionally compares planned mappings with Docker-reported published bindings before a confirmed change. Neither mode inspects arbitrary host processes or proves that a socket is free. Other Docker scopes unavailable to the read-only observer require an operator review. Validate the complete merged Compose, review the actual host and test the service after applying; port notes do not open a listener.

### Port overview workflow

The port overview separates provider forwarding, Docker publications and local notes. Detect ports again refreshes the selected observation. Configure a publication and each row's Configure action open a review dialog in the Assistant: confirmation transfers only task, address, ports and protocol. Other inputs remain; generation, saving and applying always require separate actions.

TCP rows with a host port offer a web-address review. The operator chooses HTTP or HTTPS and confirms a host reachable from their browser; no request is made and a mapping is not evidence of a listening web service. UDP rows have no web link. IPv6 addresses are bracketed in the URL. Direct opening requires a hostname different from Tuniku: host-only session cookies span ports, so same-hostname addresses must be copied into a separate private browser session. No authentication or cookie policy is changed.

### Explicit location choice

Choose location filters exposes the provider's supported country, region, city, server-name and hostname inputs. Any supported location explicitly clears those inputs and emits empty values for the provider's supported location variables. It retains category, ISP, provider options and credentials. Server selection still depends on those remaining preferences, account access and the installed Gluetun catalog; it does not promise a working VPN or a specific country. Custom fixed endpoints have no provider location choice.

Before applying an any-location proposal, review the full merged Compose and every env file: remove conflicting modern and legacy filters, including COUNTRY, REGION, CITY, SERVER_HOSTNAME, SERVER_NAME and SERVER_NUMBER. A fragment alone cannot delete existing entries or override all legacy/file settings. Recreate the affected container and inspect actual server selection. Tunnel interface addresses and public-IP geolocation are different observations from the chosen VPN server's location. Tuniku does not send new third-party geolocation requests.

Official references reviewed 2026-10-07: [Mullvad location options](https://github.com/qdm12/gluetun-wiki/blob/main/setup/providers/mullvad.md), [NordVPN location options](https://github.com/qdm12/gluetun-wiki/blob/main/setup/providers/nordvpn.md), and [Gluetun server-selection settings](https://github.com/passteque/gluetun/blob/master/internal/configuration/settings/serverselection.go). This review does not establish freshness of every provider schema.

### Provider rules and server-data freshness

Provider rules have independent documentation provenance in `src/server/compose/providerSchemaReview.json`: review date, immutable official wiki revision, per-document SHA256, rule SHA256 and review scope. The 2026-10-07 review compares offered variables, advertised protocols and credential requirements for all 23 profiles against wiki revision `888ab89a61433de6561bf60e5af52d99374f48b1`. Mullvad remains WireGuard-only despite historical OpenVPN sections in its walkthrough. Custom AmneziaWG is not offered by this adapter. Optional documentation features outside the current adapter are not automatically enabled.

The UI shows the provider-rule review separately from server catalog revision/update time. Refresh server data changes available server suggestions, not protocols, required fields, supported options or review dates. Rule changes invalidate the recorded review fingerprint and display an unreviewed state until the documentation review is updated. An official documentation review is not evidence of account login, deployed-image compatibility, a VPN handshake or leak prevention. Existing fixed-version installations still need their own runtime validation.

Raw upstream walkthrough copies remain outside the repository. Only independently produced review metadata and hashes are distributed. Maintain provider rules through reviewed changes; never advance the review date merely because server values refreshed.


## Server catalog provenance and runtime limits

Tuniku bundles an official server-data revision. Refresh resolves a full official Git commit first and retrieves the provider file from that immutable revision. The private cache records that revision, the original response SHA256 and retrieval time; the upstream server-data timestamp remains separate. Existing caches without this metadata stay usable but display an unknown revision and retrieval time until refreshed. Failed or malformed refreshes retain the existing cache.

The Assistant shows the source revision, data timestamp and retrieval or bundle time, with an exact source link where available. A refresh updates only Tuniku suggestions. The documented Gluetun Control Server API does not expose a full catalog or its revision; selected VPN settings and public-IP location are insufficient to establish equality. Runtime catalog comparison is explicitly unavailable, including when Tuniku has newer server data. No Docker exec, container archive or host-file access is added to obtain it.


## Existing and custom deployment names

The optional deployment-name section preserves the default new-stack names when empty. New setups can choose the VPN service, container, Compose project and physical external Tuniku network names. The network must already exist and be shared with Tuniku. Generated service references, the env-package target, instructions and reviewed Control Server handoff use the same VPN service name. No running resources are renamed. Tuniku and its helper service/container names, the primary tuniku project name and the tuniku-observer private network are protected from new VPN naming overrides. Renamed installations still need a manual collision and network-membership review.

For existing tasks, paste the full stack. A single identified Gluetun service is selected automatically; multiple candidates require its exact service name. An explicit name must identify an existing Gluetun candidate. Existing application names are retained exactly when they match the pasted stack. Fragments leave the base project, container name, volume definitions, labels and network settings to the original configuration. Application and VPN service names must differ. Pasted context without an identified VPN retains the default gluetun target with a warning to check the complete stack.

The bounded manager selects only the explicitly adopted project. Manual Compose names and pasted context cannot select a different managed container; manager validation uses its observed configuration and retains original runtime names and settings. These naming controls are not a migration or an automatic deploy operation.

Service identifiers follow the [Compose specification schema](https://github.com/compose-spec/compose-spec/blob/main/schema/compose-spec.json), including existing identifiers beginning with an underscore; project and container identifiers have their own validation.


## Routing across existing projects

For manual application routing, choose **Application project**. The default same-project mode uses `service:<VPN service>` and a Compose dependency. Separate-project mode requires the exact existing VPN container name and uses `container:<VPN container>` without an invalid cross-project service dependency. Merge the application fragment only into its existing project; use the separate **Download VPN port fragment** in the VPN project. Preserve existing data, labels, image and networks in both complete files.

Separate Compose projects have no coordinated startup or recovery. Start and verify the VPN before recreating the application. Recreate dependent applications after a VPN replacement; a restart keeps the old namespace identity. The bounded manager does not adopt or relocate those separate projects. These exports and instructions do not perform a migration or claim leak-free routing.

## Paths and migration review

Validation checks absolute container targets, duplicate mount destinations, source requirements, control characters and env-file syntax. Relative paths resolve from the deployment directory; interpolation, parent paths, symlinks, host-file existence, ownership and effective container permissions still require local review. Keep credential files private (0600 with an appropriate owner) and mount them read-only. Long-form binds with `create_host_path: false` avoid creating an empty directory for a missing file. Preserve existing named-volume identities and application download paths.

Before a migration, review two complete deployment files locally:

```sh
node --import tsx scripts/review-compose-migration.ts current.yml proposed.yml
```

The report lists changed service/field names and flags protected identity, storage, labels, secrets and network settings. It omits environment values and host paths and never applies changes. Exit 1 means invalid input or protected settings changed; exit 2 means usage/file errors. Exit 0 means ready for owner review, not approved or verified deployment. Review the exact local diff, back up matching data and keys, validate Compose with the real environment, and perform your approved restore test before applying. A fragment is not a replacement for a complete installation.
