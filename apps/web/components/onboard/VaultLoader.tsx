"use client";
/**
 * Vault-creation loader (from the team's done.html): a wall of tiles that flip in waves from the centre, in the
 * colour of the current stage (owner key → limits → World ID → vault), a status line with a progress bar, then
 * the "Your vault is ready" card. Driven by the real creation phases: progress never reaches 100% until the
 * vault-creation transaction has actually returned.
 */
import { useEffect, useMemo, useRef, useState } from "react";

const STAGES = [
  { at: 0, text: "Signing with your owner key", c: "#0643d2", c2: "#5c84dd" },
  { at: 25, text: "Applying your limits", c: "#a16b08", c2: "#fcbf11" },
  { at: 50, text: "Linking your World ID", c: "#096c37", c2: "#16c365" },
  { at: 75, text: "Deploying your vault", c: "#930328", c2: "#dd184c" },
];
const TILE = 64;
const PITCH = 70;

export type LoaderChip = { dot: string; label: string; mono?: boolean };

export function VaultLoader(props: {
  /** "sign" while the owner key signs, "deploy" while the relayer creates the vault, "done" when it exists */
  stage: "sign" | "deploy" | "done" | null;
  chips?: LoaderChip[];
  txUrl?: string;
  onGo?: () => void;
}) {
  const open = props.stage !== null;
  const [pct, setPct] = useState(0);
  const [done, setDone] = useState(false);
  const [size, setSize] = useState({ w: 430, h: 932 });
  const target = props.stage === "sign" ? 45 : props.stage === "deploy" ? 96 : props.stage === "done" ? 100 : 0;
  const pctRef = useRef(0);
  pctRef.current = pct;

  useEffect(() => {
    const measure = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    measure();
    let t: ReturnType<typeof setTimeout>;
    const onResize = () => (clearTimeout(t), (t = setTimeout(measure, 150)));
    window.addEventListener("resize", onResize);
    return () => (window.removeEventListener("resize", onResize), clearTimeout(t));
  }, []);

  // creep towards the current phase's target; jump to 100 when the vault exists
  useEffect(() => {
    if (!open) {
      setPct(0);
      setDone(false);
      return;
    }
    if (props.stage === "done") {
      setPct(100);
      const t = setTimeout(() => setDone(true), 500);
      return () => clearTimeout(t);
    }
    const t = setInterval(() => {
      const p = pctRef.current;
      if (p < target) setPct(Math.min(target, p + 1 + Math.random() * (props.stage === "sign" ? 2.4 : 1.4)));
    }, 140);
    return () => clearInterval(t);
  }, [open, props.stage, target]);

  const stage = [...STAGES].reverse().find((s) => pct >= s.at) ?? STAGES[0];

  const tiles = useMemo(() => {
    const cols = Math.ceil((size.w + 80) / PITCH) + 1;
    const rows = Math.ceil((size.h + 80) / PITCH) + 1;
    const cx = (cols - 1) / 2;
    const cy = ((rows - 1) / 2) * 0.9;
    const max = Math.hypot(cx, cy);
    const out: { key: string; d: string }[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push({ key: `${r}-${c}`, d: `${((Math.hypot(c - cx, r - cy) / max) * 1.9).toFixed(3)}s` });
    return { cols, list: out };
  }, [size]);

  return (
    <div
      className={`vl${open ? " open" : ""}${done ? " done" : ""}`}
      role="status"
      aria-live="polite"
      style={{ ["--accent" as string]: stage.c, ["--accent2" as string]: stage.c2 }}
    >
      <div className="vl-wall" style={{ gridTemplateColumns: `repeat(${tiles.cols}, ${TILE}px)` }} aria-hidden>
        {tiles.list.map((t) => (
          <div key={t.key} className="vl-t" style={{ ["--d" as string]: t.d }}>
            <i className="vl-f" />
            <i className="vl-b" />
          </div>
        ))}
      </div>
      <div className="vl-veil" aria-hidden />
      <div className="vl-halo" aria-hidden />

      <div className="vl-status">
        <strong>Creating your vault</strong>
        <div className="vl-step">{stage.text}</div>
        <div className="vl-line">
          <span style={{ width: `${pct}%` }} />
        </div>
        <div className="vl-pct">{Math.round(pct)}%</div>
      </div>

      <div className="vl-ready">
        <div className="vl-orb" />
        <h2>Your vault is ready</h2>
        <p>
          Your agent is on a leash.
          <br />
          It can only spend within the limits you set.
        </p>
        {props.chips && (
          <div className="vl-meta">
            {props.chips.map((c) => (
              <span key={c.label} className={c.mono ? "mono" : undefined} style={{ ["--c" as string]: c.dot }}>
                {c.label}
              </span>
            ))}
          </div>
        )}
        {props.txUrl && (
          <a className="text-[13px] font-medium text-blue underline-offset-4 hover:underline" href={props.txUrl} target="_blank" rel="noreferrer">
            View the creation transaction
          </a>
        )}
      </div>
      <button type="button" className="vl-cta" onClick={props.onGo} disabled={!done}>
        Go to my vault
      </button>
    </div>
  );
}
