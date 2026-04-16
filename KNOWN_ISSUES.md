# Known Issues

## Performance

### High INP on debuff settings interaction
- **Symptom**: Clicking CC items in the debuff tracking settings causes ~376ms INP (Interaction to Next Paint)
- **Cause**: `addCC()`/`removeCC()` triggers `fullRebuild()` which destroys and recreates BOTH Highcharts instances (DPS + Debuff), even though only the debuff chart needs updating
- **Impact**: UI freezes briefly when toggling tracked debuffs in the settings gear menu
- **Fix direction**:
  1. Only rebuild debuff chart when CC list changes, skip DPS chart
  2. Debounce CC changes (wait 500ms after last toggle before rebuild)
  3. Use `chart.update()` / `series.setData()` instead of destroy+recreate

### Floating window affects main charts
- **Symptom**: Opening dialog charts (Cumulative, DPS, ConditionChart) can cause the main DPS/Debuff chart to flicker or rebuild
- **Cause**: Dialog charts call `setTimeRange()`/`clearTimeRange()` on zoom, which updates global store state that the main chart's `history` computed depends on
- **Impact**: Chart flickers when interacting with floating windows
- **Fix direction**: Decouple main chart from global timeRange, or use separate timeRange scopes per chart instance

### `damages[]` unbounded growth
- **Symptom**: Memory usage increases continuously during long sessions
- **Cause**: `ActorManager.damages[]`, per-entity `_takeDamages[]`/`_applyDamages[]`, and `DamageCollectorManager._damages[]` grow without limit
- **Impact**: Browser slowdown or crash after hours of play
- **Fix direction**: Add a cap (e.g. 50K entries) with oldest-first eviction, or clear on instance/scene change

## Functionality

### No instance/scene separation
- **Symptom**: Running the same boss twice shows both fights merged in the DPS chart with a blank gap in between; debuff coverage % is diluted by idle time
- **Cause**: No mechanism to detect scene changes or dungeon instance boundaries
- **Fix direction**: Detect `OpcodeUnknownWarp` (0x526e) or mass `EntitiesDisappear` to split sessions; frontend shows per-instance tabs or dropdown
