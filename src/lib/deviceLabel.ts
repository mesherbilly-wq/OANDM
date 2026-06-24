/**
 * Returns a short label prefix for a device based on its type.
 * Ordered most-specific → least-specific so the right code wins.
 * System-type fallbacks are used only when the device type gives no match.
 */
export function getDevicePrefix(systemType: string, deviceType: string): string {
  const dt = (deviceType ?? '').toLowerCase().trim();

  // ── Number Plate / ANPR ────────────────────────────────────────────────────
  if (dt.includes('licence') || dt.includes('license') || dt.includes('lpr') || dt.includes('number plate')) return 'LIC';
  if (dt.includes('anpr')) return 'ANC';

  // ── PTZ Camera ─────────────────────────────────────────────────────────────
  if (dt.includes('ptz')) return 'PTZ';

  // ── CCTV Cameras ───────────────────────────────────────────────────────────
  if (
    dt.includes('camera') || dt === 'cam' || dt.includes(' cam') ||
    dt.includes('cctv') || dt.includes('dome') || dt.includes('bullet') ||
    dt.includes('turret') || dt.includes('fisheye') || dt.includes('fixed cam') ||
    dt.includes('ip cam') || dt.includes('covert')
  ) return 'CAM';

  // ── Recording ──────────────────────────────────────────────────────────────
  if (dt.includes('nvr') || dt.includes('network video recorder')) return 'NVR';
  if (dt.includes('dvr') || dt.includes('digital video recorder')) return 'DVR';
  if (dt.includes('encoder')) return 'ENC';
  if (dt.includes('vms') || dt.includes('video management')) return 'VMS';
  if (dt.includes('recorder')) return 'REC';
  if (dt.includes('monitor') && !dt.includes('indoor')) return 'MON';

  // ── Door hardware (Access Control) ─────────────────────────────────────────
  if (
    dt.includes('push to exit') || dt.includes('request to exit') ||
    dt.includes('exit button') || dt.includes('rex button') || dt === 'pte'
  ) return 'PTE';

  if (
    dt.includes('break glass') || dt.includes('break-glass') ||
    dt.includes('manual call point') || dt === 'bgu'
  ) return 'BGU';

  if (
    dt.includes('door contact') || dt.includes('door position') ||
    dt.includes('door status') || dt.includes('magnetic contact') ||
    dt.includes('reed switch') || dt === 'dps'
  ) return 'DPS';

  if (
    dt.includes('maglock') || dt.includes('mag lock') ||
    dt.includes('electromagnetic lock') || dt.includes('electromag') ||
    dt.includes('electric strike') || dt.includes('mortise lock') ||
    dt.includes('electric lock') || dt.includes(' lock') || dt === 'lock'
  ) return 'LCK';

  // ── Access Control readers / panels ────────────────────────────────────────
  if (
    dt.includes('card reader') || dt.includes('smart reader') ||
    dt.includes('proximity reader') || dt.includes('reader') ||
    dt.includes('fob') || dt.includes('badge')
  ) return 'RDR';

  if (dt.includes('keypad') || dt.includes('pin pad') || dt.includes('code pad')) return 'KPD';

  if (
    dt.includes('door controller') || dt.includes('access controller') ||
    dt.includes('access control panel') || dt.includes('acm') ||
    dt.includes('access panel') || dt.includes('door unit') ||
    dt.includes('dcu') || dt.includes('access unit')
  ) return 'DCU';

  if (dt.includes('controller') || dt.includes('control panel')) return 'CTRL';

  // ── Intercom ───────────────────────────────────────────────────────────────
  if (
    dt.includes('video door') || dt.includes('door entry') ||
    dt.includes('door station') || dt.includes('entry panel') ||
    dt.includes('door phone') || dt.includes('video intercom')
  ) return 'VDP';

  if (
    dt.includes('indoor monitor') || dt.includes('answering unit') ||
    dt.includes('internal monitor') || dt.includes('vdu')
  ) return 'VDU';

  if (
    dt.includes('intercom') || dt.includes('call point') ||
    dt.includes('call station') || dt.includes('call unit')
  ) return 'INT';

  // ── Intruder Detectors ─────────────────────────────────────────────────────
  if (
    dt.includes('pir') || dt.includes('passive infra') ||
    dt.includes('motion detector') || dt.includes('motion sensor') ||
    dt.includes('dual tech')
  ) return 'PIR';

  if (dt.includes('glass break')) return 'GBD';
  if (dt.includes('shock') || dt.includes('vibration sensor')) return 'SHK';
  if (dt.includes('smoke')) return 'SMK';
  if (dt.includes('heat detector') || dt.includes('heat sensor')) return 'HTD';
  if (dt.includes('carbon monoxide') || dt.includes('co detector')) return 'COD';

  if (
    dt.includes('panic button') || dt.includes('personal attack') ||
    dt.includes('pa button') || dt.includes('holdup')
  ) return 'PAB';

  if (
    dt.includes('siren') || dt.includes('sounder') ||
    dt.includes('bell box') || dt.includes('strobe siren')
  ) return 'SND';

  if (dt.includes('alarm panel') || dt.includes('intruder panel') || dt.includes('control unit')) return 'ACP';

  if (
    dt.includes('active infra') || dt.includes('beam detector') ||
    dt.includes('infrared beam') || dt.includes('air beam')
  ) return 'BDT';

  if (dt.includes('detector') || dt.includes('sensor')) return 'DET';

  // ── Networking ─────────────────────────────────────────────────────────────
  if (
    dt.includes('access point') || dt.includes('wireless ap') ||
    dt.includes('wap') || dt.includes('wifi ap') || dt.includes('wi-fi')
  ) return 'WAP';

  if (dt.includes('router')) return 'RTR';
  if (dt.includes('firewall') || dt.includes('utm')) return 'FWL';
  if (dt.includes('patch panel')) return 'PP';
  if (dt.includes('media converter') || dt.includes('fibre converter')) return 'MCV';
  if (dt.includes('switch') || dt.includes('poe')) return 'NSW';
  if (dt.includes('server') || dt.includes('workstation')) return 'SRV';

  // ── Power ──────────────────────────────────────────────────────────────────
  if (dt.includes('power supply') || dt.includes(' psu') || dt === 'psu') return 'PSU';
  if (dt.includes(' ups') || dt === 'ups' || dt.includes('uninterruptible')) return 'UPS';
  if (dt.includes('battery')) return 'BAT';

  // ── Perimeter Detection ────────────────────────────────────────────────────
  if (dt.includes('fence') || dt.includes('perimeter')) return 'PD';
  if (dt.includes('laser scanner') || dt.includes('lidar')) return 'LSR';

  // ── System-type fallbacks ──────────────────────────────────────────────────
  switch (systemType) {
    case 'CCTV':                return 'CAM';
    case 'Access Control':      return 'RDR';
    case 'Intercom':            return 'INT';
    case 'Intruder':            return 'DET';
    case 'Networking':          return 'NSW';
    case 'ANPR':                return 'ANC';
    case 'Perimeter Detection': return 'PD';
    default:                    return 'DEV';
  }
}
