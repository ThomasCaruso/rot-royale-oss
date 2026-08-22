import UIKit
import Capacitor
import UserNotifications

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        requestProvisionalNotifications()
        return true
    }

    /// PROVISIONAL authorization (iOS 12+): permission WITHOUT a prompt.
    ///
    /// The player sees nothing. Notifications are delivered quietly to Notification Center — no
    /// banner, no sound, no lock screen — each carrying "Keep"/"Turn Off" buttons, and "Keep" lets
    /// them choose prominent delivery themselves.
    ///
    /// Crucially this does NOT spend the one-time system prompt: the app can still call
    /// `requestPermissions()` later (our in-app sheet, after a first completed run) and iOS shows
    /// the real alert then. So this is additive, not a trade — it makes a player reachable from
    /// launch while leaving the prompt to be spent at the right moment.
    ///
    /// Requested for EVERY install because it is silent and costs the player nothing. Who actually
    /// receives quiet pushes is decided server-side (`me.provisional_push`, a percentage rollout):
    /// a token is only registered for players in the cohort, so the blast radius is a setting, not
    /// a new binary. A refusal here is not an error — it simply means no quiet delivery.
    private func requestProvisionalNotifications() {
        let center = UNUserNotificationCenter.current()
        center.getNotificationSettings { settings in
            // Only for a player who has not answered yet. Re-requesting would do nothing for an
            // authorized user and must never downgrade someone who already said yes properly.
            guard settings.authorizationStatus == .notDetermined else { return }
            center.requestAuthorization(options: [.alert, .sound, .badge, .provisional]) { granted, _ in
                guard granted else { return }
                DispatchQueue.main.async {
                    UIApplication.shared.registerForRemoteNotifications()
                }
            }
        }
    }

    // REQUIRED by @capacitor/push-notifications: iOS hands the APNs device token to the app
    // delegate, and the plugin only learns about it through these two posts. Without them the
    // plugin's `registration` listener never fires, so `registerAndGetToken()` waits out its
    // 8-second timeout and returns null — every iOS opt-in failed silently, which is why the
    // production database held zero iOS subscriptions.
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
