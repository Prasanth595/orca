public enum FocusedApplicationResolution {
    public enum SystemObservation: Equatable {
        case application(Int32?)
        case absent
        case unavailable
    }

    public static func processID(system: SystemObservation, frontmostPID: Int32?) -> Int32? {
        let candidate: Int32?
        switch system {
        case let .application(pid): candidate = pid
        case .absent: candidate = nil
        case .unavailable: candidate = frontmostPID
        }
        guard let candidate, candidate > 0 else { return nil }
        return candidate
    }
}
