/** Outpero-style India stack: one Indic STT + one Indic TTS, not English TTS reading Hindi. */
export const indiaVoice = {
  voice: {
    provider: "sarvam" as const,
    voice_id: "priya",
    speech_speed: 0.95,
  },
  transcriber: {
    provider: "sarvam" as const,
    language: "unknown",
    silence_timeout_ms: 200,
    interruption_min_words: 2,
    max_call_duration_in_sec: 420,
    should_apply_noise_reduction: true,
    first_ideal_message: "Hello? Ananya hoon.",
    is_first_ideal_message_dynamic: false,
    second_ideal_message: "Line pe ho kya?",
    is_second_ideal_message_dynamic: false,
  },
  background_track: { enabled: true, name: "office" as const, volume: 0.05 },
};
