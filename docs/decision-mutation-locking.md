# Decision mutation locking

`saveDecision` and `deleteDecision` acquire an exclusive directory lock at
`<absolute decisions file path>.lock` before reading decisions and hold it through
the complete read-modify-write transaction, including the atomic JSON replacement.
All callers must supply the same `decisionsFile` path used by their load/write
functions. The registered tool supplies the configured state path and its
cancellation signal. Reads remain lock-free; atomic replacement keeps them from
observing partial JSON. Decision basis behavior is unchanged.

## Ownership and contention

Atomic directory creation establishes ownership. `owner.json` records a random
acquisition token, PID, hostname, and acquisition time (diagnostic information,
not a lease). Release checks directory identity and the token before unlinking
only the owner file and removing the empty directory; it never recursively
removes a lock. Setup/write/read/operation failures release in `finally` when
ownership is established. If identity cannot be established or release fails,
the operation fails closed and the directory may need manual recovery.

Acquisition polls at 50 ms intervals for up to 10 seconds by default, then fails
without reading or writing decisions. Each competing process waits independently;
there is no fairness guarantee. Filesystem calls themselves depend on filesystem
responsiveness; this is a bounded contention wait, not a filesystem I/O timeout.

## Stale locks and recovery

**Locks are never automatically stolen**, regardless of age, recorded PID,
missing/malformed metadata, or apparent owner death. This avoids mistaking a
paused writer or a writer on another host for a stale lock.

After abrupt termination (including SIGKILL or host failure), the lock remains.
To recover, stop decision writers and verify no process can still be using the
lock, **including writers on other hosts sharing the state directory**. Only
then manually remove that specific `.lock` directory and retry. Do not remove or
alter an active lock. PID absence on one host and acquisition age are insufficient
proof. There is intentionally no automated recovery tool.

## Cancellation and limits

An already-aborted signal prevents acquisition; cancellation while waiting stops
the wait without touching another owner's lock. After acquisition, cancellation
is checked before entering the transaction and again before the JSON write.
The owned lock is released on cooperative failure/cancellation. Cancellation
cannot safely interrupt an in-progress atomic write or roll it back; once writing
starts it finishes under the lock. No process signal handlers are installed:
uncooperative termination follows the orphan-lock policy above.

Every writer must participate in this protocol. Direct JSON edits, older package
versions, inconsistent/symlink-aliased paths, or filesystems without atomic mkdir
and rename semantics are outside the guarantee. Lock directories must not be
modified by other actors during a transaction. No dependency or platform-specific
lock service is required.
