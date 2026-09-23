# jvm-interop

Truffle interop across a `jvm-channel` `Channel`: objects living in the "other
JVM" appear here as `OtherJvmObject` proxies, and each interop message on a
proxy is serialized, executed on the other side, and its result sent back.

## Object lifetime

- `OtherJvmPool` is the handle table. Every non-meta object sent across gets a
  **fresh ID** in `objectsById`, held strongly — sending the same object twice
  creates two handles. Meta objects (classes) are cached by identity instead
  (`objectsToId` here, `incomming` on the receiving side).
- A handle is released only after its proxy is collected: `OtherJvmRef` (a
  `WeakReference` on a `ReferenceQueue`) is enqueued by the GC, and
  `OtherJvmRef.flushQueue` sends `OtherJvmMessage.GC(id)` — on the _next_
  message sent, not immediately.

Consequence for tests: probing whether a remote object is still alive by calling
into it pins it again. `OtherJvmGCTest.assertGC` therefore collects _after_ the
flush, in the window where no handle pins the object; without that it depended
on an incidental GC and failed at random (#22).

## Testing

`Channel.create(null, …)` builds a mock channel with both sides in one JVM, so
`System.gc()` collects both. Tests fork (`Test / fork := true`). Per the note in
`build.sbt`, `-ea` must stay off for Truffle itself (it adds checks that skew
the message counts some tests assert on), so it is enabled only for
`org.enso.jvm...`.

```bash
sbt 'jvm-interop/testOnly org.enso.jvm.interop.impl.OtherJvmGCTest'
```

A GC-dependent test passing locally proves little: the default heap is a quarter
of RAM, so incidental collections differ from CI. To remove them, run with a
young generation large enough to absorb the test's allocations:

```bash
sbt 'set `jvm-interop`/Test/javaOptions ++= Seq("-XX:+UseParallelGC","-Xms8g","-Xmx8g","-Xmn6g")' \
    'jvm-interop/testOnly org.enso.jvm.interop.impl.OtherJvmGCTest'
```
