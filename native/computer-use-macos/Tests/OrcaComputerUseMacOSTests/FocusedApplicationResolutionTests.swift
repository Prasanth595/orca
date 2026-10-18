import XCTest
@testable import OrcaComputerUseMacOSCore

final class FocusedApplicationResolutionTests: XCTestCase {
    func testUnreadableSystemFocusUsesCurrentAppKitForegroundIdentity() {
        XCTAssertEqual(
            FocusedApplicationResolution.processID(system: .unavailable, frontmostPID: 42),
            42
        )
    }

    func testSystemFocusOnAnotherApplicationCannotBeOverriddenByFallback() {
        XCTAssertEqual(
            FocusedApplicationResolution.processID(system: .application(17), frontmostPID: 42),
            17
        )
    }

    func testDismissedFocusDoesNotFallBackToAStaleFrontmostApplication() {
        XCTAssertNil(FocusedApplicationResolution.processID(system: .absent, frontmostPID: 42))
    }

    func testInvalidAndUnavailableIdentitiesFailClosed() {
        for observation: FocusedApplicationResolution.SystemObservation in [.application(nil), .application(0), .application(-1)] {
            XCTAssertNil(FocusedApplicationResolution.processID(system: observation, frontmostPID: 42))
        }
        for pid: Int32? in [nil, 0, -1] {
            XCTAssertNil(FocusedApplicationResolution.processID(system: .unavailable, frontmostPID: pid))
        }
    }
}
