import { useEffect, useRef } from "react";

const CHANNEL_NAME = "claim_adjudication_sync";

/**
 * Broadcast an update event across all open tabs, windows, and components.
 */
export function broadcastClaimUpdate(action = "UPDATE", payload = {}) {
  const message = { action, payload, timestamp: Date.now() };

  // 1. Cross-tab BroadcastChannel
  try {
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(CHANNEL_NAME);
      channel.postMessage(message);
      channel.close();
    }
  } catch {
    // Ignore BroadcastChannel errors
  }

  // 2. Storage event (cross-tab fallback)
  try {
    localStorage.setItem("last_claim_update", JSON.stringify(message));
  } catch {
    // Ignore localStorage errors
  }

  // 3. Same-window CustomEvent
  try {
    window.dispatchEvent(new CustomEvent("claim_state_changed", { detail: message }));
  } catch {
    // Ignore CustomEvent errors
  }
}

/**
 * Hook to automatically synchronize view data whenever an adjudication,
 * claim update, or appeal decision occurs anywhere in the application.
 */
export function useClaimSync(onUpdate, pollIntervalMs = 3000) {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    const triggerUpdate = () => {
      if (typeof onUpdateRef.current === "function") {
        onUpdateRef.current();
      }
    };

    // 1. BroadcastChannel listener
    let channel = null;
    try {
      if (typeof BroadcastChannel !== "undefined") {
        channel = new BroadcastChannel(CHANNEL_NAME);
        channel.onmessage = () => triggerUpdate();
      }
    } catch {
      channel = null;
    }

    // 2. Storage event listener (cross-tab fallback)
    const handleStorage = (e) => {
      if (e.key === "last_claim_update") {
        triggerUpdate();
      }
    };
    window.addEventListener("storage", handleStorage);

    // 3. Same-window CustomEvent listener
    const handleCustomEvent = () => triggerUpdate();
    window.addEventListener("claim_state_changed", handleCustomEvent);

    // 4. Window focus & visibility listener
    const handleFocus = () => triggerUpdate();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        triggerUpdate();
      }
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    // 5. Short polling fallback (3 seconds)
    let intervalId = null;
    if (pollIntervalMs && pollIntervalMs > 0) {
      intervalId = setInterval(() => triggerUpdate(), pollIntervalMs);
    }

    return () => {
      if (channel) {
        try {
          channel.close();
        } catch {
          // Ignore
        }
      }
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("claim_state_changed", handleCustomEvent);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
      if (intervalId) clearInterval(intervalId);
    };
  }, [pollIntervalMs]);
}

