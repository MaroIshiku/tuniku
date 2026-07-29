import type { SVGProps } from "react";

const paths: Record<string, string[]> = {
  overview: ["M4 13h6V3H4v10Zm0 8h6v-6H4v6Zm10 0h6V11h-6v10Zm0-18v6h6V3h-6Z"],
  vpn: ["M12 2 4 5v6c0 5.1 3.4 9.8 8 11 4.6-1.2 8-5.9 8-11V5l-8-3Zm0 4a3 3 0 0 1 3 3v1h1v6H8v-6h1V9a3 3 0 0 1 3-3Zm0 2a1 1 0 0 0-1 1v1h2V9a1 1 0 0 0-1-1Z"],
  ports: ["M5 5h4v4H5V5Zm10 0h4v4h-4V5ZM5 15h4v4H5v-4Zm10 0h4v4h-4v-4ZM9 7h6M7 9v6m10-6v6M9 17h6"],
  code: ["m8 9-3 3 3 3m8-6 3 3-3 3m-2-9-4 12"],
  menu: ["M5 7h14M5 12h14M5 17h14"],
  settings: ["M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8 3.5-.1-1.4 2-1.6-2-3.5-2.5 1a8 8 0 0 0-2.4-1.4L14.6 2h-5.2L9 5.1a8 8 0 0 0-2.4 1.4l-2.5-1L2 9l2 1.6L4 12l.1 1.4L2 15l2 3.5 2.5-1A8 8 0 0 0 9 18.9l.4 3.1h5.2l.4-3.1a8 8 0 0 0 2.4-1.4l2.5 1L22 15l-2-1.6.1-1.4Z"],
  close: ["M6 6l12 12M18 6 6 18"],
  refresh: ["M20 6v5h-5M4 18v-5h5M6.1 9a7 7 0 0 1 11.3-2.6L20 11M4 13l2.6 4.6A7 7 0 0 0 17.9 15"],
  play: ["m9 7 8 5-8 5V7Z"],
  stop: ["M8 8h8v8H8z"],
  copy: ["M9 9h10v10H9zM5 15V5h10"],
  add: ["M12 5v14M5 12h14"],
  edit: ["m4 20 4.5-1 10-10-3.5-3.5-10 10L4 20Zm9.5-13.5 3.5 3.5"],
  delete: ["M5 7h14m-10 4v6m6-6v6M9 4h6l1 3H8l1-3Zm-2 3 1 14h8l1-14"],
  download: ["M12 3v12m-4-4 4 4 4-4M5 20h14"],
  warning: ["M12 3 2 21h20L12 3Zm0 6v5m0 3h.01"],
  check: ["m5 12 4 4L19 6"],
  info: ["M12 11v6m0-10h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z"],
  globe: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0 0c2.5-2.7 4-6.2 4-10S14.5 4.7 12 2m0 20c-2.5-2.7-4-6.2-4-10S9.5 4.7 12 2M2 12h20"],
  dns: ["M4 5h16v5H4V5Zm0 9h16v5H4v-5Zm3-6h.01M7 17h.01m4-9h6m-6 9h6"],
  activity: ["M3 12h4l2-6 4 12 2-6h6"],
  user: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7 8a7 7 0 0 0-14 0"],
  chevron: ["m9 18 6-6-6-6"],
  external: ["M14 4h6v6m0-6-9 9M20 13v7H4V4h7"]
};

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: string }) {
  const iconPaths = paths[name] ?? paths.info!;
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {iconPaths.map((path, index) => <path key={index} d={path} />)}
    </svg>
  );
}
