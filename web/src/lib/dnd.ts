import { KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors, type KeyboardSensorOptions } from '@dnd-kit/core';

/**
 * Drag sensors that leave touch scrolling alone. A mouse drags after a few pixels; a finger drags only after a short
 * press-and-hold, so swiping across cards (the board's columns, a long list) scrolls instead of picking a card up.
 */
export function useDragSensors(distance = 5, keyboard: KeyboardSensorOptions = {}) {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, keyboard),
  );
}
