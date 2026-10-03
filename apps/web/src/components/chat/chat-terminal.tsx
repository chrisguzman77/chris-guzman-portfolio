"use client";

import { Eraser, Maximize2, Minimize2, X } from "lucide-react";
import Link from "next/link";
import { useTheme } from "next-themes";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import { Turnstile } from "@/components/contact/turnstile";
import {
  CHAT_LIMITS,
  CHAT_MESSAGES,
  askQuestion,
  createSession,
  type ChatSource,
} from "@/lib/chat";

import { TypedText } from "./typed-text";

const HEIGHT_KEY = "chat-panel-height";
const DEFAULT_HEIGHT = 40;
const MIN_HEIGHT = 25;
const MAX_HEIGHT = 90;
const STEP = 5;

type Line =
  | { id: number; kind: "question"; text: string }
  | { id: number; kind: "answer"; text: string; sources: ChatSource[]; animate: boolean }
  | { id: number; kind: "notice"; text: string };

// Omit does not distribute over a union, so spell the id-less variants out.
type LineInput = Line extends infer L ? (L extends Line ? Omit<L, "id"> : never) : never;

type Session = { status: "connecting" } | { status: "ready"; id: string } | { status: "closed" };

const iconButton =
  "rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent-brand";

function clamp(vh: number): number {
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(vh)));
}

function savedHeight(): number {
  try {
    const value = Number(window.localStorage.getItem(HEIGHT_KEY));
    return value ? clamp(value) : DEFAULT_HEIGHT;
  } catch {
    return DEFAULT_HEIGHT;
  }
}

function saveHeight(vh: number) {
  try {
    window.localStorage.setItem(HEIGHT_KEY, String(vh));
  } catch {
    // Storage blocked (private mode): the panel still works, it just forgets its size.
  }
}

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function ChatTerminal({
  hidden,
  onClose,
  apiUrl,
  siteKey,
  suggestions,
}: {
  hidden: boolean;
  onClose: () => void;
  apiUrl: string;
  siteKey: string;
  suggestions: string[];
}) {
  const { resolvedTheme } = useTheme();
  const [lines, setLines] = useState<Line[]>([]);
  const [session, setSession] = useState<Session>({ status: "connecting" });
  const [thinking, setThinking] = useState(false);
  const [input, setInput] = useState("");
  const [height, setHeight] = useState(savedHeight);
  const [maximized, setMaximized] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const nextId = useRef(0);
  const opening = useRef(false);
  const dragging = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hidden) inputRef.current?.focus();
  }, [hidden]);

  useEffect(() => {
    scroller.current?.scrollTo?.({ top: scroller.current.scrollHeight });
  }, [lines, thinking]);

  function push(line: LineInput) {
    const id = nextId.current++;
    setLines((current) => [...current, { ...line, id } as Line]);
  }

  function notice(text: string) {
    push({ kind: "notice", text });
  }

  async function onToken(token: string | null) {
    if (!token || opening.current) return;
    opening.current = true;
    const result = await createSession(apiUrl, token);
    if (result.kind === "ok") {
      setSession({ status: "ready", id: result.sessionId });
    } else {
      setSession({ status: "closed" });
      notice(CHAT_MESSAGES[result.failure]);
    }
  }

  function onTurnstileError() {
    if (opening.current) return;
    opening.current = true;
    setSession({ status: "closed" });
    notice(CHAT_MESSAGES.unavailable);
  }

  async function ask(raw: string) {
    const question = raw.trim();
    if (!question || session.status !== "ready" || thinking) return;
    setInput("");
    if (question.length > CHAT_LIMITS.question) {
      notice(CHAT_MESSAGES.tooLong);
      return;
    }
    push({ kind: "question", text: question });
    setThinking(true);
    const result = await askQuestion(apiUrl, session.id, question);
    setThinking(false);
    if (result.kind === "answer") {
      push({
        kind: "answer",
        text: result.answer,
        sources: result.sources,
        animate: !reducedMotion(),
      });
      setAnnouncement(result.answer);
      return;
    }
    if (result.failure === "ended" || result.failure === "sessionLimit") {
      setSession({ status: "closed" });
    }
    notice(CHAT_MESSAGES[result.failure]);
  }

  function clear() {
    setLines([]);
    setAnnouncement("");
    setSession({ status: "connecting" });
    opening.current = false;
    setResetSignal((n) => n + 1); // a fresh Turnstile token opens the next session
    inputRef.current?.focus();
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(input);
  }

  function resizeTo(vh: number) {
    const next = clamp(vh);
    setMaximized(false);
    setHeight(next);
    saveHeight(next);
  }

  function onHandleKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowUp") resizeTo((maximized ? MAX_HEIGHT : height) + STEP);
    else if (event.key === "ArrowDown") resizeTo((maximized ? MAX_HEIGHT : height) - STEP);
    else return;
    event.preventDefault();
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    dragging.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    setMaximized(false);
    setHeight(clamp(((window.innerHeight - event.clientY) / window.innerHeight) * 100));
  }

  function onPointerUp() {
    if (!dragging.current) return;
    dragging.current = false;
    saveHeight(height);
  }

  function onRegionKey(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
  }

  const current = maximized ? MAX_HEIGHT : height;
  const placeholder =
    session.status === "connecting"
      ? "connecting…"
      : session.status === "closed"
        ? "press clear to start a new session"
        : "type a question…";

  return (
    <section
      role="region"
      aria-label="Ask about Chris"
      hidden={hidden}
      onKeyDown={onRegionKey}
      style={{ "--panel-h": `${current}vh` } as CSSProperties}
      className="fixed inset-x-0 bottom-0 z-50 flex h-dvh flex-col border-t border-border bg-background shadow-2xl md:h-(--panel-h)"
    >
      <div
        role="separator"
        aria-label="Resize terminal"
        aria-orientation="horizontal"
        aria-valuemin={MIN_HEIGHT}
        aria-valuemax={MAX_HEIGHT}
        aria-valuenow={current}
        tabIndex={0}
        onKeyDown={onHandleKey}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="hidden h-2 shrink-0 cursor-ns-resize items-center justify-center focus-visible:outline-2 focus-visible:outline-accent-brand md:flex"
      >
        <span className="h-0.5 w-9 rounded bg-input" />
      </div>
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-1.5 pt-[max(0.375rem,env(safe-area-inset-top))] md:pt-1.5">
        <div className="flex items-center gap-4 text-[11px]">
          <span className="border-b border-accent-brand pb-1 tracking-widest text-foreground">
            TERMINAL
          </span>
          <span className="pb-1 font-mono text-muted-foreground">ask-chris</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={clear}
            aria-label="Clear and start a new session"
            className={iconButton}
          >
            <Eraser className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setMaximized((m) => !m)}
            aria-label={maximized ? "Restore terminal size" : "Maximize terminal"}
            className={`${iconButton} hidden md:inline-flex`}
          >
            {maximized ? (
              <Minimize2 className="size-3.5" aria-hidden />
            ) : (
              <Maximize2 className="size-3.5" aria-hidden />
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close terminal"
            className={iconButton}
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      </div>
      <div
        ref={scroller}
        className="flex-1 space-y-2 overflow-y-auto px-4 py-3 font-mono text-xs leading-relaxed"
      >
        <p className="text-muted-foreground">{CHAT_MESSAGES.welcome}</p>
        {suggestions.length > 0 ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
            <span>Try:</span>
            {suggestions.map((question, i) => (
              <button
                key={question}
                type="button"
                onClick={() => void ask(question)}
                className="text-left text-accent-brand underline underline-offset-4 hover:opacity-80"
              >
                {`[${i + 1}] ${question}`}
              </button>
            ))}
          </div>
        ) : null}
        <Turnstile
          siteKey={siteKey}
          theme={resolvedTheme === "light" ? "light" : "dark"}
          resetSignal={resetSignal}
          onToken={(token) => void onToken(token)}
          onError={onTurnstileError}
        />
        {lines.map((line) =>
          line.kind === "question" ? (
            <p key={line.id} className="pt-1">
              <span className="text-accent-brand">visitor@chris</span>
              <span className="text-muted-foreground">:~$</span> <span>{line.text}</span>
            </p>
          ) : line.kind === "answer" ? (
            <div key={line.id}>
              <TypedText text={line.text} animate={line.animate} />
              <p className="text-muted-foreground">
                sources →{" "}
                {line.sources.map((source) => (
                  <Link
                    key={source.n}
                    href={source.url}
                    className="mr-3 underline underline-offset-4 hover:text-foreground"
                  >
                    {`[${source.n}] ${source.title}`}
                  </Link>
                ))}
              </p>
            </div>
          ) : (
            <p key={line.id} role="status" className="text-muted-foreground">
              {line.text}
            </p>
          ),
        )}
        {thinking ? (
          <p className="animate-pulse text-muted-foreground">{CHAT_MESSAGES.thinking}</p>
        ) : null}
        <div aria-live="polite" className="sr-only">
          {announcement}
        </div>
      </div>
      <form
        onSubmit={onSubmit}
        className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] font-mono text-xs"
      >
        <label htmlFor="chat-input" className="sr-only">
          Ask a question about Chris
        </label>
        <span aria-hidden className="shrink-0">
          <span className="text-accent-brand">visitor@chris</span>
          <span className="text-muted-foreground">:~$</span>
        </span>
        <input
          id="chat-input"
          ref={inputRef}
          type="text"
          autoComplete="off"
          enterKeyHint="send"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-foreground caret-accent-brand outline-none [caret-shape:block] placeholder:text-muted-foreground"
        />
      </form>
    </section>
  );
}
