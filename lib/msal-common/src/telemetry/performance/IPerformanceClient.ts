/*
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { Counters, PerformanceEvent, PerformanceEvents, StaticFields } from "./PerformanceEvent";
import { IPerformanceMeasurement } from "./IPerformanceMeasurement";

export type PerformanceCallbackFunction = (events: PerformanceEvent[]) => void;

export type InProgressPerformanceEvent = {
    endMeasurement: (event?: Partial<PerformanceEvent>) => PerformanceEvent | null
    flushMeasurement: () => void,
    discardMeasurement: () => void,
    addStaticFields: (staticFields: StaticFields) => void,
    increment: (counters: Counters) => void,
    event: PerformanceEvent,
    measurement: IPerformanceMeasurement
};

export interface IPerformanceClient {
    startMeasurement(measureName: PerformanceEvents, correlationId?: string): InProgressPerformanceEvent;
    endMeasurement(event: PerformanceEvent): PerformanceEvent | null;
    flushMeasurements(measureName: PerformanceEvents, correlationId?: string): void;
    discardMeasurements(correlationId: string): void;
    addStaticFields(staticFields: StaticFields, correlationId: string): void;
    removePerformanceCallback(callbackId: string): boolean;
    addPerformanceCallback(callback: PerformanceCallbackFunction): string;
    emitEvents(events: PerformanceEvent[], correlationId: string): void;
    startPerformanceMeasurement(measureName: string, correlationId: string): IPerformanceMeasurement;
    generateId(): string;
}
