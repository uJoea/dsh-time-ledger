# Interaction-gated measurement of active time in a plugin-based agent harness

*Axes: task = manuscript · paper_type = methods · section = abstract + intro · language = zh-to-en · journal = generic*

## Abstract

Time spent with an interactive coding agent is usually reported as session duration: the interval during which a window existed. That quantity is easy to log and difficult to interpret, because presence, idleness and background execution accumulate into a single number. We describe dstime, an instrument for a plugin-based agent harness that reports active time rather than session time. The design rests on three explicit quantities: a state is *active* only while the window is visible and input has occurred within the preceding 60 seconds; one *session* is a maximal run of active states separated by gaps shorter than 15 minutes; and a session shorter than one minute is discarded rather than rounded. Records are held in a single local JSON file written by atomic replacement and merged across windows by their last-update time, so several windows can observe the same history without overwriting each other. A floating card reports the current session and the current day, and a calendar exposes year, month and per-session views. The instrument defines and persists its units consistently; it does not yet establish that measured activity corresponds to the user's attention.

## 1. Introduction

Agent harnesses have become long-running environments. A single session can remain open across an afternoon of intermittent work, and the wall-clock interval it spans mixes genuine operation with waiting, background execution and an unattended window. When the question is how much work a person actually did — for cost attribution, for self-monitoring, or for comparing working patterns across days — the recorded interval answers a different question than the one being asked. Time is an attractive unit precisely because it is comparable across tasks, providers and models; it becomes misleading when the quantity being summed is presence rather than engagement.

The difficulty is not measuring elapsed time. It is deciding which intervals deserve to be counted. An open window passes through at least three distinguishable states: the window is visible and the user is issuing input; the window is visible but idle; and the window is not visible at all. Conventional session logs collapse the three into one span, because a session begins when the process starts and ends when it stops. The resulting number is reproducible and almost never describes the work: a session left open overnight and a session of continuous debugging contribute the same kind of evidence.

Prior work in this ecosystem has approached the problem from both ends. Request-level accounting instruments the model call: tokens, cost and latency per turn are increasingly well observed, and they answer what the agent consumed rather than what the person did. Session timers instrument the container: they report how long a conversation has existed, which is the quantity criticized above. General-purpose activity monitors on the operating system sit at a different layer: they detect idle time from input events, which is the standard and reliable primitive, but they observe the machine rather than the agent, and they cannot attribute an interval to a particular conversation or separate foreground work from a window left in the background. Idle detection itself is settled; what remains unresolved is a definition of one use that survives restarts, multiple windows and the ordinary ambiguity of an intermittent workday, together with a persistence scheme that keeps that definition consistent when several windows are open.

Here we describe dstime, an instrument that makes the unit of measurement explicit and then holds to it. The contribution is a measurement design rather than a comparative evaluation: (i) a three-state model in which activity requires both visibility and recent input, with fixed thresholds of 60 seconds for idleness and 15 minutes for closing a session; (ii) a session definition that merges activity across short gaps, discards fragments below one minute, and marks sessions that cross midnight instead of splitting them; (iii) a persistence layer that writes one local JSON file by atomic replacement and reconciles concurrent windows by last-update time, with a browser-local copy as a fallback while the host route is unreachable; and (iv) two presentations of the same record, a floating card for the present moment and a calendar for year, month and per-session review. We report the design and its semantics, and we state the boundary at which the claim stops.

## 2. System overview

The instrument is split along the boundary the harness already provides. A host-side module owns storage and exposes a single HTTP route on the loopback interface: `GET` returns the stored history, `POST` merges a client's history and returns the merged result, non-JSON bodies are refused, and every write goes through a queue so that two writes cannot interleave. A client-side module owns the timer and the interface. It samples the window's visibility and the time of the most recent input, advances the active clock only while both conditions hold, and pushes the record to the host on a fixed interval.

The two halves fail independently, which is deliberate. If the host route is unavailable, the client keeps timing and holds the record in browser-local storage, and the card says so; when the route returns, the local record is merged into the file. If the file is unreadable or written by an incompatible version, the host starts from an empty history rather than failing, and the next write repairs the file.

## 3. Measurement semantics

| Quantity | Definition | Consequence |
| --- | --- | --- |
| Active state | Window visible and input within the last 60 s | The active clock advances |
| Idle state | Window visible, no input for more than 60 s | The clock stops; the session stays open |
| Background state | Window not visible | The clock stops; the session stays open |
| Session | Maximal run of activity with internal gaps below 15 min | Closing a session records it |
| Discarded fragment | Recorded duration below 1 min | Not stored, not counted in any view |
| Cross-midnight session | A session whose start and end fall on different days | Kept whole and marked; not split at midnight |

These choices trade precision for interpretability. A short threshold would count scrolling past a window as work; a long one would merge a lunch break into a morning session. The values are fixed in the implementation rather than exposed as settings, because a unit that changes silently is not a unit.

## 4. Persistence and reconciliation

The record is a list of sessions, each with a start, an end, a set of per-day duration buckets and an update timestamp. Storage writes to a temporary file and renames it over the original, so a crash leaves either the old file or the new one. When several windows report at once, the host merges by session identity and keeps the record with the later update time; sessions are then ordered by start and the list is capped, so an unbounded history cannot grow without limit. The data file contains timestamps and durations only — no conversation text, no file paths and no identifiers — and the client makes no request beyond the local route.

## 5. Boundary and outlook

The claim of this design is narrow: usage time can be defined as interaction-gated activity and recorded consistently by a two-part plugin. It is not a claim that the measured quantity equals attention. No ground-truth comparison has been performed, and the fixed thresholds have not been calibrated against observed behaviour; a user who reads for twenty minutes without typing is, under this definition, idle. The instrument is also per host: it has no cross-device aggregation, and it does not attempt to measure model compute or cost, which the request-level ledger already covers.

Two extensions follow from those boundaries. Thresholds could be exposed as a preference while the session boundary stays fixed, which would let a user calibrate idleness without changing what a session means. And the exported record is small enough to support a validation study in which self-reported working intervals are compared against measured ones; until such a comparison exists, reports produced by this instrument should be read as a consistent index of engagement rather than a measurement of it.

---

## Section outline

- **Abstract**: problem (session duration ≠ work) → three design quantities → persistence → presentation → explicit non-claim.
- **Intro §1**: the field stake — long-running harnesses make wall-clock time a misleading unit.
- **Intro §2**: the specific difficulty — three states collapse into one span in conventional logs.
- **Intro §3**: what prior work establishes (request accounting, session timers, OS idle detection) and the exact unresolved gap (a portable definition of one use plus consistent multi-window persistence).
- **Intro §4**: the contribution as a measurement design, with the study route stated before the semantics.
- **§2–§4**: system split, semantics table, persistence and reconciliation.
- **§5**: boundary (no ground truth, per host, fixed thresholds) and two bounded extensions.

## Assumptions or missing inputs

- No evaluation data exists. The document therefore describes the design and its semantics and makes no accuracy, adoption or performance claim. `[Evidence needed: comparison of measured active time against self-reported working intervals]`
- The 60 s / 15 min / 1 min thresholds are implementation constants; whether they match a given user's working rhythm is untested.
- Platform coverage is Windows-first in practice (the default data directory is a Windows path); no cross-platform claim is made.
- Target venue is unspecified, so generic Nature-leaning structure is used without journal-specific limits.

## Claim-evidence map

- Claim: activity requires visibility and recent input, not merely an open window. | Evidence: `IDLE_MS = 60 s`, `CLOSE_AFTER_MS = 15 min` in the client timer; state transitions driven by visibility and last-input time. | Status: supported.
- Claim: fragments below one minute are excluded rather than rounded. | Evidence: `MIN_RECORD_MS = 60 s`; the host rejects a session whose accumulated time is shorter. | Status: supported.
- Claim: concurrent windows cannot overwrite each other's history. | Evidence: host merges by session identity using the later `updatedAt`; writes are serialized through a queue. | Status: supported.
- Claim: a crash leaves a readable file. | Evidence: temporary file plus rename, with a retry after removing a stale target. | Status: supported.
- Claim: measured time corresponds to user attention. | Evidence: none. | Status: needs evidence.
- Claim: the thresholds are well calibrated. | Evidence: none; values are fixed constants. | Status: needs evidence.

## Why this structure

- The abstract leads with the definition of the unit rather than a result, because the contribution is the definition; a result-led abstract would have to invent a number.
- The introduction uses an application-first funnel: a concrete complaint (an afternoon-long window) narrows to the three-state problem, then to the gap, before the design is named.
- Prior work is grouped by layer (request, session, operating system) so the gap reads as a missing layer rather than a missing citation.
- The boundary paragraph is placed before any extension, so the two extensions are visibly derived from named limits rather than added as features.

## 中文说明

结构上做了三处取舍。第一，摘要以「测量单位是什么」开头，而不是以效果开头——这个插件没有对照实验，写任何提升幅度都会变成编造；把 60 秒空闲、15 分钟断点、1 分钟丢弃这三个量写成定义，读者才知道数字是怎么来的。第二，引言用「应用先行」的写法：先讲一个开一下午的窗口这种具体困扰，再收敛到三态问题，最后才点出已有工作缺的是哪一层（请求级计费、会话计时、系统级空闲检测都已有，缺的是「一次使用」的可移植定义与多窗口一致性）。第三，局限放在展望之前，并且两条展望都由局限直接推出来，避免读成功能清单。

需要你补的只有一件事：如果要做成真正的论文，需要一个把实测活跃时长与自报工作时段对照的验证实验；现在的文本明确写了没有这个证据。

## To redirect me

指出具体段落或具体论断（例如「三态那段的顺序」或「边界段把平台限制写弱了」），我只改那一处，保持其余段落不动。
