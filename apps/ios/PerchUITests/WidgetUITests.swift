import XCTest

/// Adds the Unread widget to the Home Screen and opens an article from it.
/// Same setup as ReaderUITests (TEST_RUNNER_PERCH_DEV_*); it drives
/// SpringBoard, so it's slower and more fragile than the reading test.
@MainActor
final class WidgetUITests: XCTestCase {
  private let env = ProcessInfo.processInfo.environment
  private let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")

  override func setUp() async throws {
    continueAfterFailure = false
    try XCTSkipIf(env["PERCH_DEV_SERVER"] == nil, "No test server configured")
  }

  private func shot(_ name: String) {
    let png = XCUIScreen.main.screenshot().pngRepresentation
    let attachment = XCTAttachment(data: png, uniformTypeIdentifier: "public.png")
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
    if let dir = env["PERCH_SHOTS"] {
      try? png.write(to: URL(filePath: dir).appending(path: "\(name).png"))
    }
  }

  /// The accessibility tree, next to the screenshots, for fixing the steps
  /// when iOS changes its Home Screen.
  private func dump(_ name: String) {
    if let dir = env["PERCH_SHOTS"] {
      try? springboard.debugDescription.write(
        to: URL(filePath: dir).appending(path: "\(name).txt"), atomically: true, encoding: .utf8)
    }
  }

  func testWidgetOpensArticle() throws {
    // A leftover system prompt would swallow the taps.
    let cancel = springboard.alerts.buttons["Cancel"].firstMatch
    if cancel.exists { cancel.tap() }

    // Sign in, so the app writes the widget's snapshot.
    let app = XCUIApplication()
    for key in ["PERCH_DEV_SERVER", "PERCH_DEV_USER", "PERCH_DEV_PASSWORD"] {
      app.launchEnvironment[key] = env[key]
    }
    app.launch()
    XCTAssertTrue(app.collectionViews.cells.firstMatch.waitForExistence(timeout: 20))
    sleep(4)
    XCUIDevice.shared.press(.home)
    sleep(1)

    // Edit the Home Screen (long-press an empty spot), add the widget.
    dump("home")
    springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.72))
      .press(forDuration: 1.5)
    sleep(1)
    dump("editing")
    shot("editing")
    let edit = springboard.buttons["Edit"].firstMatch
    if edit.waitForExistence(timeout: 3) {
      edit.tap()
      sleep(1)
      dump("edit-menu")
    }
    springboard.buttons["Add Widget"].firstMatch.tap()
    let search = springboard.searchFields.firstMatch
    XCTAssertTrue(search.waitForExistence(timeout: 5))
    search.tap()
    search.typeText("Perch")
    let result = springboard.cells.containing(.staticText, identifier: "Perch").firstMatch
    if result.waitForExistence(timeout: 5) {
      result.tap()
    } else {
      springboard.staticTexts["Perch"].firstMatch.tap()
    }
    sleep(2)
    // Medium size: the second page of the size picker.
    springboard.scrollViews.firstMatch.swipeLeft()
    sleep(1)
    shot("widget-gallery")
    dump("gallery")
    springboard.buttons.matching(NSPredicate(format: "label CONTAINS 'Add Widget'")).firstMatch
      .tap()
    sleep(2)
    XCUIDevice.shared.press(.home)
    sleep(3)
    shot("widget-home")

    // Tap the first article in the widget.
    let widget = springboard.otherElements.matching(identifier: "Perch").firstMatch
    let target = widget.exists ? widget : springboard.otherElements["Unread"].firstMatch
    XCTAssertTrue(target.waitForExistence(timeout: 5))
    target.coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: 0.2)).tap()
    XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
    XCTAssertTrue(app.buttons["Close"].waitForExistence(timeout: 10), "the article opens")
    sleep(2)
    shot("widget-opened")
  }
}
