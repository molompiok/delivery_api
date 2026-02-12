/**
 * GeoCompressor
 * 
 * Utilities for compressing GPS traces while preserving shape.
 * Implements Ramer-Douglas-Peucker (RDP) algorithm.
 */

export class GeoCompressor {
    /**
     * Simplifies a list of points using the Ramer-Douglas-Peucker algorithm.
     * 
     * @param points - Array of points [lng, lat]
     * @param epsilon - Tolerance in degrees (approx 0.0001 is ~11 meters)
     * @returns Simplified array of points
     */
    static simplifyRDP(points: number[][], epsilon: number = 0.0001): number[][] {
        if (points.length <= 2) return points

        let maxDistance = 0
        let index = 0

        const end = points.length - 1
        for (let i = 1; i < end; i++) {
            const distance = this.getPerpendicularDistance(points[i], points[0], points[end])
            if (distance > maxDistance) {
                index = i
                maxDistance = distance
            }
        }

        if (maxDistance > epsilon) {
            const recursiveResult1 = this.simplifyRDP(points.slice(0, index + 1), epsilon)
            const recursiveResult2 = this.simplifyRDP(points.slice(index), epsilon)

            return [...recursiveResult1.slice(0, recursiveResult1.length - 1), ...recursiveResult2]
        } else {
            return [points[0], points[end]]
        }
    }

    /**
     * Helper to calculate perpendicular distance of a point from a line segment.
     */
    private static getPerpendicularDistance(point: number[], start: number[], end: number[]): number {
        const x = point[0]
        const y = point[1]
        const x1 = start[0]
        const y1 = start[1]
        const x2 = end[0]
        const y2 = end[1]

        const numerator = Math.abs((y2 - y1) * x - (x2 - x1) * y + x2 * y1 - y2 * x1)
        const denominator = Math.sqrt(Math.pow(y2 - y1, 2) + Math.pow(x2 - x1, 2))

        return numerator / denominator
    }

    /**
     * Compresses an order trace [lng, lat, timestamp]
     * Preserves timestamps for the kept points.
     */
    static compressTrace(points: [number, number, string][], epsilon: number = 0.0001): [number, number, string][] {
        if (points.length <= 2) return points

        const coordsOnly = points.map(p => [p[0], p[1]])
        const simplifiedIndices = this.getSimplifiedIndices(coordsOnly, epsilon)

        return simplifiedIndices.map(idx => points[idx])
    }

    private static getSimplifiedIndices(points: number[][], epsilon: number): number[] {
        if (points.length <= 2) return points.map((_, i) => i)

        const stack: [number, number][] = [[0, points.length - 1]]
        const resultIndices = new Set<number>([0, points.length - 1])

        while (stack.length > 0) {
            const [start, end] = stack.pop()!
            let maxDistance = 0
            let index = 0

            for (let i = start + 1; i < end; i++) {
                const distance = this.getPerpendicularDistance(points[i], points[start], points[end])
                if (distance > maxDistance) {
                    index = i
                    maxDistance = distance
                }
            }

            if (maxDistance > epsilon) {
                resultIndices.add(index)
                stack.push([start, index])
                stack.push([index, end])
            }
        }

        return Array.from(resultIndices).sort((a, b) => a - b)
    }
}
