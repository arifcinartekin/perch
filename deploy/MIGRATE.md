# Moving Perch to another server

Everything a Perch Server knows lives in two places: its data folder (the SQLite database,
which also holds the instance secret that signs sessions and sign-up challenges, plus the
backups) and `deploy/.env`. Caddy's certificates are made again on the new machine. Moving is
copying those two things while the old server is stopped, then pointing DNS at the new one.

Expect a few minutes when Perch doesn't answer: from stopping the old server until DNS reaches
people. Apps keep working offline meanwhile; sync rounds and shares just wait.

## The day before

1. In Cloudflare, check that every Perch record is "DNS only" (grey) with TTL **Auto** (300 s);
   that's what lets the switch reach people in minutes. The records: `app`, `account`, `sync`
   and, if you run it, `demo`.
2. Set up the new server with the usual script, using the same names. Its certificates can't be
   issued until DNS points at it, so Caddy will retry in the background; that's expected.

   ```sh
   curl -fsSL https://raw.githubusercontent.com/arifcinartekin/perch/main/deploy/setup.sh \
     | sudo bash -s -- app.perch.ws sync.perch.ws
   ```

3. On the new server, stop what setup started; it gets the real data later:

   ```sh
   sudo docker compose -f /opt/perch/deploy/compose.yml down
   ```

4. From your computer, copy the old `.env` to the new server (it holds no secrets on the
   official servers, but copy it rather than retyping):

   ```sh
   scp OLD:/opt/perch/deploy/.env /tmp/perch.env && scp /tmp/perch.env NEW:/tmp/perch.env && rm /tmp/perch.env
   ssh NEW 'sudo install -m 600 /tmp/perch.env /opt/perch/deploy/.env && rm /tmp/perch.env'
   ```

## The move

5. On the **old** server, take a last backup, then stop Perch so the database can't change:

   ```sh
   sudo /opt/perch/deploy/backup.sh
   sudo docker compose -f /opt/perch/deploy/compose.yml down
   ```

6. Copy the data folders straight from old to new (run on the old server; `NEW` is the new
   server's address, reachable over SSH with your key):

   ```sh
   sudo tar -C /var/lib -czf - perch perch-demo | ssh NEW 'sudo tar -C /var/lib -xzf -'
   ```

   Leave out `perch-demo` if you don't run the demo server. After a clean stop SQLite has
   nothing left in its `-wal` file, so the `.db` file alone is complete.

7. On the **new** server, give the folders to the image's user and start Perch:

   ```sh
   sudo chown -R 1000:1000 /var/lib/perch /var/lib/perch-demo
   sudo /opt/perch/deploy/update.sh
   ```

8. In Cloudflare, change the A (and AAAA, if any) records of `app`, `account`, `sync` and `demo`
   to the new server's address. Keep them grey.

9. Within a few minutes Caddy gets the certificates. Check:

   ```sh
   curl -s https://app.perch.ws/api/v1/server        # "build": the commit you expect
   curl -s https://account.perch.ws/api/v1/server
   curl -s -o /dev/null -w '%{http_code}\n' https://sync.perch.ws/api/v1/server
   ```

   Then sign in on account.perch.ws with your account and run a sync round on a device in a
   chain: both prove the database and the instance secret came across (old sessions still work,
   chains carry on from where they were).

## Afterwards

10. Keep the old server stopped (not deleted) for a few days in case something was missed.
    Then delete its data and the machine itself:

    ```sh
    sudo rm -rf /var/lib/perch /var/lib/perch-demo /opt/perch
    ```

    and cancel the server at the provider, which wipes the disk.

11. Update the policies: the hosting provider, its country and the "data transfer" paragraph in
    site/privacy.html (EN and TR), and the date at the top. If the new server is in the EU, the
    cross-border transfer paragraph about Canada goes away.

## If it goes wrong

Before step 8 nothing has changed for anyone: start the old server again
(`sudo /opt/perch/deploy/update.sh` on it) and try another day. After step 8, point DNS back at
the old address and start it again; anything written on the new server in between (new
accounts, shares, chain records) would be lost, so decide quickly.
