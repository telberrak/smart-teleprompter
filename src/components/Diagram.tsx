// Sample diagram for the bundled 1.3 script. Real Excalidraw steps arrive in milestone 6.
interface Props { upTo: number; ghost?: boolean }

export function Diagram({ upTo, ghost }: Props) {
  const cls = (n: number) => "d-step" + (n > upTo ? (ghost ? " ghost" : " off") : "");
  return (
    <svg viewBox="0 0 640 360" role="img" aria-label="What is an API diagram">
      <g className={cls(1)}>
        <text className="d-txt" x="320" y="52" textAnchor="middle" fontSize="40" fontWeight="700">What is an API?</text>
        <path className="d-ink" d="M200 64 C 260 70, 380 68, 444 63" />
      </g>
      <g className={cls(2)}>
        <rect className="d-fill-a" x="40" y="100" width="120" height="62" rx="10" /><rect className="d-ink" x="40" y="100" width="120" height="62" rx="10" />
        <text className="d-txt" x="100" y="139" textAnchor="middle" fontSize="26">Customer</text>
        <rect className="d-fill-c" x="260" y="100" width="120" height="62" rx="10" /><rect className="d-ink" x="260" y="100" width="120" height="62" rx="10" />
        <text className="d-txt" x="320" y="139" textAnchor="middle" fontSize="26">Waiter</text>
        <rect className="d-fill-b" x="480" y="100" width="120" height="62" rx="10" /><rect className="d-ink" x="480" y="100" width="120" height="62" rx="10" />
        <text className="d-txt" x="540" y="139" textAnchor="middle" fontSize="26">Kitchen</text>
        <path className="d-ink" d="M164 131 L 254 131 M244 123 L254 131 L244 139" />
        <path className="d-ink" d="M384 131 L 474 131 M464 123 L474 131 L464 139" />
      </g>
      <g className={cls(3)}>
        <text className="d-txt" x="100" y="196" textAnchor="middle" fontSize="22" fill="#555">= your app</text>
        <text className="d-txt" x="320" y="196" textAnchor="middle" fontSize="22" fill="#555">= the API</text>
        <text className="d-txt" x="540" y="196" textAnchor="middle" fontSize="22" fill="#555">= the server</text>
      </g>
      <g className={cls(4)}>
        <path className="d-ink" d="M110 236 C 250 220, 400 220, 530 236 M518 228 L530 236 L518 244" stroke="#1971c2" />
        <text className="d-txt" x="320" y="216" textAnchor="middle" fontSize="24" fill="#1971c2">request</text>
        <path className="d-ink" d="M530 270 C 400 290, 250 290, 110 270 M122 262 L110 270 L122 278" stroke="#2f9e44" />
        <text className="d-txt" x="320" y="306" textAnchor="middle" fontSize="24" fill="#2f9e44">response (JSON)</text>
      </g>
      <g className={cls(5)}>
        <text className="d-txt" x="610" y="345" textAnchor="end" fontSize="22" fill="#e8590c">Next: your first request →</text>
      </g>
    </svg>
  );
}
