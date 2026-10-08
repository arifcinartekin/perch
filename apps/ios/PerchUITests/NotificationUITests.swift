import XCTest

/// Turns on new-article notifications in Settings and allows them in the
/// system prompt. Same setup as ReaderUITests (TEST_RUNNER_PERCH_DEV_*).
@MainActor
final class NotificationUITests: XCTestCase {
  private let env = ProcessInfo.processInfo.environment

  override func setUp() async throws {
    continueAfterFailure = false
    try XCTSkipIf(env["PERCH_DEV_SERVER"] == nil, "No test server configured")
  }

  func testTurningOnNotifications() throws {
    let app = XCUIApplication()
    for key in ["PERCH_DEV_SERVER", "PERCH_DEV_USER", "PERCH_DEV_PASSWORD"] {
      app.launchEnvironment[key] = env[key]
    }
    app.launchEnvironment["PERCH_DEV_TAB"] = "settings"
    app.launch()

    let toggle = app.switches["New articles"].firstMatch
    XCTAssertTrue(toggle.waitForExistence(timeout: 20))
    if (toggle.value as? String) == "1" { return }
    toggle.switches.firstMatch.tap()

    // The system asks once; allow.
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    let allow = springboard.alerts.buttons["Allow"].firstMatch
    if allow.waitForExistence(timeout: 5) { allow.tap() }
    let on = NSPredicate(format: "value == '1'")
    expectation(for: on, evaluatedWith: toggle)
    waitForExpectations(timeout: 5)
  }
}
