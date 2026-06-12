from __future__ import annotations

import asyncio
import json
import uuid
from collections import defaultdict
from typing import AsyncIterator

from .job_store import JobStore
from .models import JobEvent, JobStatus, utc_now


class JobEventBus:
    def __init__(self, store: JobStore) -> None:
        self._store = store
        self._subscribers: dict[str, set[asyncio.Queue[JobEvent]]] = defaultdict(set)
        self._sequence_locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

    async def publish(
        self,
        job_id: str,
        event_type: str,
        status: JobStatus,
        payload: dict | None = None,
    ) -> JobEvent:
        async with self._sequence_locks[job_id]:
            seq = len(await self._store.list_events(job_id)) + 1
            event = JobEvent(
                eventId=f"evt_{uuid.uuid4().hex[:16]}",
                jobId=job_id,
                seq=seq,
                type=event_type,
                status=status,
                payload=payload or {},
                timestamp=utc_now(),
            )
            await self._store.append_event(event)

        for queue in list(self._subscribers.get(job_id, set())):
            await queue.put(event)
        return event

    async def stream(self, job_id: str) -> AsyncIterator[str]:
        queue: asyncio.Queue[JobEvent] = asyncio.Queue()
        self._subscribers[job_id].add(queue)
        delivered_sequences: set[int] = set()

        try:
            existing_events = await self._store.list_events(job_id)
            for event in existing_events:
                delivered_sequences.add(event.seq)
                yield self.format_sse(event)

            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15)
                    if event.seq in delivered_sequences:
                        continue
                    delivered_sequences.add(event.seq)
                    yield self.format_sse(event)
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
        finally:
            self._subscribers[job_id].discard(queue)
            if not self._subscribers[job_id]:
                self._subscribers.pop(job_id, None)

    @staticmethod
    def format_sse(event: JobEvent) -> str:
        return (
            f"id: {event.seq}\n"
            f"event: {event.type}\n"
            f"data: {json.dumps(event.model_dump(mode='json'), ensure_ascii=False)}\n\n"
        )
