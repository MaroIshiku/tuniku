# ZimaOS deployment notes

ZimaOS wording and controls can differ between versions. The workflow remains
manual:

1. Create a custom Compose stack from `docker-compose.example.yml`.
2. Create the three Tuniku secret files in a persistent host directory.
3. Adjust the secret file paths in the stack.
4. Configure Gluetun using the current official documentation.
5. Save and deploy the stack in ZimaOS.
6. Complete Tuniku first-run registration.
7. Configure `http://gluetun:8000` as the Control Server URL.

To place another application behind Gluetun:

1. Add `network_mode: "service:gluetun"` to that application service.
2. Publish its required web port on the Gluetun service.
3. Remove a conflicting port mapping from the application service.
4. Save and redeploy the stack manually.
5. Verify both the application UI and its public IP behavior.

Tuniku generates this guidance but does not save the ZimaOS stack, press
deploy, recreate containers, or authenticate to the foreign application.
