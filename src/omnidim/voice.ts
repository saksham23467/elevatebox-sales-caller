/** Outpero-style India stack: one Indic STT + one Indic TTS, not English TTS reading Hindi. */
export const indiaVoice = {
  voice: {
    provider: "sarvam" as const,
    voice_id: "simran",
    speech_speed: 1,
  },
  transcriber: {
    provider: "sarvam" as const,
    language: "unknown",
    silence_timeout_ms: 240,
    interruption_min_words: 2,
    max_call_duration_in_sec: 240,
    should_apply_noise_reduction: true,
    user_idle_threshold_sec: 10,
    first_ideal_message: "",
    second_ideal_message: "",
    last_ideal_message: "Bye.",
  },
  background_track: {
    enabled: true,
    name: "office" as const,
    volume: 0.07,
    tts_volume_reduction: 0.1,
  },
};
