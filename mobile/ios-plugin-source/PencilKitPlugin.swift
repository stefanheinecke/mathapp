//
//  PencilKitPlugin.swift
//  Custom Capacitor Plugin: praesentiert ein natives PencilKit-Zeichenfenster und liefert die
//  Zeichnung als PNG (Base64 Data-URL) an JavaScript zurueck.
//
//  INSTALLATION (auf dem Mac, nachdem `npx cap add ios` gelaufen ist):
//  1. Diese Datei + PencilKitPlugin.m + PencilKitViewController.swift in Xcode in den Ordner
//     ios/App/App/ ziehen ("Copy items if needed" ankreuzen).
//  2. Xcode fragt beim ersten Swift-File automatisch nach einer Bridging-Header-Erstellung -> Ja.
//  3. Cmd+B (Build). Das Plugin ist danach unter window.Capacitor.Plugins.PencilKit in JS verfuegbar.
//
import Foundation
import Capacitor

@objc(PencilKitPlugin)
public class PencilKitPlugin: CAPPlugin {
    @objc func openCanvas(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let presentingVC = self.bridge?.viewController else {
                call.reject("Kein ViewController verfuegbar.")
                return
            }

            let pencilVC = PencilKitViewController()
            pencilVC.modalPresentationStyle = .fullScreen
            pencilVC.onFinish = { image in
                presentingVC.dismiss(animated: true)
                guard let image = image, let pngData = image.pngData() else {
                    call.reject("Keine Zeichnung erhalten.")
                    return
                }
                let base64 = pngData.base64EncodedString()
                call.resolve(["image": "data:image/png;base64,\(base64)"])
            }
            pencilVC.onCancel = {
                presentingVC.dismiss(animated: true)
                call.reject("Abgebrochen.")
            }
            presentingVC.present(pencilVC, animated: true)
        }
    }
}
