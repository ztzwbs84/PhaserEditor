<!--
Vendored from Phaser 4.2.1 skills/particles/references/REFERENCE.md.
Upstream SHA-256: cfe9e9f5b6a2bdc1a14175fb676d699eab283a231631f7ac2b215ab8a6f71215.
This is an on-demand reference, not a separately registered skill.
-->
# Particle System -- Reference

## Source File Map

| File | Purpose |
|---|---|
| `src/gameobjects/particles/ParticleEmitter.js` | Main emitter class -- config parsing, all methods |
| `src/gameobjects/particles/ParticleEmitterFactory.js` | `this.add.particles()` factory |
| `src/gameobjects/particles/Particle.js` | Individual particle: fire, update, death logic |
| `src/gameobjects/particles/GravityWell.js` | Gravity well processor |
| `src/gameobjects/particles/ParticleProcessor.js` | Base class for processors |
| `src/gameobjects/particles/ParticleBounds.js` | Rectangular bounds processor |
| `src/gameobjects/particles/EmitterOp.js` | EmitterOp value formats (start/end, random, stepped) |
| `src/gameobjects/particles/EmitterColorOp.js` | Color interpolation op |
| `src/gameobjects/particles/zones/` | RandomZone, EdgeZone, DeathZone |
| `src/gameobjects/particles/events/` | COMPLETE, DEATH_ZONE, EXPLODE, START, STOP |
| `src/gameobjects/particles/typedefs/ParticleEmitterConfig.js` | Full config typedef |
