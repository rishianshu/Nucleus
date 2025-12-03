from __future__ import annotations

from typing import Iterable

from endpoint_service.events.types import Event, EventCategory, EventType, Subscriber


class StateEventSubscriber(Subscriber):
    """Subscriber that forwards state events to a state handler."""

    def __init__(self, state_handler) -> None:
        self.state_handler = state_handler

    def interests(self) -> Iterable[EventCategory]:
        return (EventCategory.STATE,)

    def on_event(self, event: Event) -> None:
        if event.type == EventType.STATE_MARK:
            self.state_handler.mark_event(**event.payload)
        elif event.type == EventType.STATE_WATERMARK:
            self.state_handler.set_progress(**event.payload)
        elif event.type == EventType.STATE_PROGRESS:
            self.state_handler.progress_event(**event.payload)
