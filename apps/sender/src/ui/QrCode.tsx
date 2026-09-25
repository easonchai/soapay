// A QR code as an <img> (data URL from the `qrcode` package). Presentational only.
import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function QrCode({ value, size = 192 }: { value: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(value, { width: size, margin: 1, errorCorrectionLevel: "M" })
      .then((u) => live && setSrc(u))
      .catch(() => live && setSrc(null));
    return () => {
      live = false;
    };
  }, [value, size]);
  return src ? <img src={src} width={size} height={size} alt="Invite link QR code" /> : <div style={{ width: size, height: size }} />;
}
