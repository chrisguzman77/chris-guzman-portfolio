# Portfolio VM

## How VM 400 was built (Proxmox 9.1, 2026-09-29)

- Template **9000** `ubuntu-2404-cloudinit` from `noble-server-cloudimg-amd64.img` on storage `local` (qcow2), `vmbr0`, cloud-init drive, serial console, guest agent enabled.
- Full clone **400** `portfolio`: 4 vCPU, **4 GiB fixed** (`--balloon 0`; the host has 15 GiB shared with lab VMs, which no longer auto-start), 60 GB disk, `ciuser chris` with the owner's SSH key, `192.168.1.50/24` gw `192.168.1.254`, `onboot 1`, `startup order=1`.
- In the VM: `qemu-guest-agent` installed; timezone `America/New_York`.
- Proxmox backup job: daily 03:00, snapshot mode, zstd, keep last 7, VM 400 only, storage `local`.

Remote access: `ssh -J root@<proxmox-tailscale-ip> chris@192.168.1.50`.

## Bootstrap

```bash
sudo git clone https://github.com/chrisguzman77/chris-guzman-portfolio.git /opt/portfolio
cd /opt/portfolio && sudo ./infra/vm/bootstrap.sh
```

Re-running it is safe. It prints the VM's age public key, which must be added to `.sops.yaml` (then `sops updatekeys infra/compose/prod.enc.env`) before the VM can decrypt production secrets.

## Rebuild from scratch

Recreate the VM from template 9000 with the settings above, bootstrap, add the new public key to `.sops.yaml`, run the first deploy (`docs/runbook.md`), and restore data from the latest Proxmox backup or database dump.
