// Mutes and unmutes the default microphone of Windows. Soundpad's remote control has no command for the
// microphone, so this is the one thing the plugin asks Windows for. The script below is fixed text: nothing
// typed in a panel or saved in a profile ever becomes part of it.
import { execFile } from 'node:child_process';

export const POWERSHELL = 'powershell.exe';

const TIMEOUT_MS = 15_000;

// IAudioEndpointVolume through COM. The eleven placeholders stand for the methods before SetMute in the
// interface, which have to be there for the call to land on the right slot.
const SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int p1(); int p2(); int p3(); int p4(); int p5(); int p6(); int p7(); int p8(); int p9(); int p10(); int p11();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
  int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid iid, int context, IntPtr parameters, [MarshalAs(UnmanagedType.IUnknown)] out object endpoint);
}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int p1();
  int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice device);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorClass { }
public static class Microphone {
  static IAudioEndpointVolume Endpoint() {
    var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorClass();
    IMMDevice device;
    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(1, 0, out device));
    var iid = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
    object endpoint;
    Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out endpoint));
    return (IAudioEndpointVolume)endpoint;
  }
  public static bool Muted() { bool m; Marshal.ThrowExceptionForHR(Endpoint().GetMute(out m)); return m; }
  public static bool Set(bool mute) { var g = Guid.Empty; Marshal.ThrowExceptionForHR(Endpoint().SetMute(mute, ref g)); return Muted(); }
}
'@
`;

const TAILS = {
  read: "if ([Microphone]::Muted()) { 'muted' } else { 'unmuted' }",
  toggle: "if ([Microphone]::Set(-not [Microphone]::Muted())) { 'muted' } else { 'unmuted' }",
};

/**
 * @param {'read'|'toggle'} mode
 * @param {typeof execFile} [run] replaced by tests
 * @returns {Promise<{muted: boolean}>}
 */
export function microphone(mode, run = execFile) {
  const encoded = Buffer.from(SCRIPT + TAILS[mode], 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    run(
      POWERSHELL,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 },
      (error, stdout) => {
        const answer = String(stdout ?? '').trim();
        if (error || (answer !== 'muted' && answer !== 'unmuted')) {
          reject(new Error('microphone'));
          return;
        }
        resolve({ muted: answer === 'muted' });
      },
    );
  });
}
