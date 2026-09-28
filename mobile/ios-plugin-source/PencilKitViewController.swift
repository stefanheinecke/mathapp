//
//  PencilKitViewController.swift
//  Volles-Bild natives Zeichenfenster: kariertes Papier (wie im Web) + PKCanvasView mit Apple
//  Pencil-Unterstuetzung + Apples eigenes PKToolPicker (Stift/Marker/Radierer/Farben). Der
//  "Fertig"-Button rendert die sichtbare Flaeche (Karo-Hintergrund + Zeichnung) in ein UIImage.
//
import UIKit
import PencilKit

class PencilKitViewController: UIViewController {
    var onFinish: ((UIImage?) -> Void)?
    var onCancel: (() -> Void)?

    private let canvasView = PKCanvasView()
    private var toolPicker: PKToolPicker?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .white

        let gridView = GridBackgroundView(frame: view.bounds)
        gridView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        gridView.isOpaque = false
        view.addSubview(gridView)

        canvasView.frame = view.bounds
        canvasView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        canvasView.backgroundColor = .clear
        canvasView.isOpaque = false
        canvasView.drawingPolicy = .anyInput // erlaubt Zeichnen auch ohne Apple Pencil (Finger)
        view.addSubview(canvasView)

        let cancelButton = makeButton(title: "Abbrechen", action: #selector(cancelTapped))
        let clearButton = makeButton(title: "Löschen", action: #selector(clearTapped))
        let doneButton = makeButton(title: "Fertig", action: #selector(finishTapped), filled: true)

        let toolbar = UIStackView(arrangedSubviews: [cancelButton, clearButton, doneButton])
        toolbar.axis = .horizontal
        toolbar.distribution = .fillEqually
        toolbar.spacing = 12
        toolbar.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(toolbar)

        NSLayoutConstraint.activate([
            toolbar.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            toolbar.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
            toolbar.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -12),
            toolbar.heightAnchor.constraint(equalToConstant: 44),
        ])
    }

    private func makeButton(title: String, action: Selector, filled: Bool = false) -> UIButton {
        let button = UIButton(type: .system)
        button.setTitle(title, for: .normal)
        button.titleLabel?.font = .boldSystemFont(ofSize: 16)
        button.layer.cornerRadius = 8
        if filled {
            button.backgroundColor = UIColor(red: 0.10, green: 0.23, blue: 0.56, alpha: 1)
            button.setTitleColor(.white, for: .normal)
        } else {
            button.backgroundColor = UIColor(white: 0.93, alpha: 1)
            button.setTitleColor(.darkText, for: .normal)
        }
        button.addTarget(self, action: action, for: .touchUpInside)
        return button
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if let window = view.window {
            let picker = PKToolPicker.shared(for: window)
            picker?.setVisible(true, forFirstResponder: canvasView)
            picker?.addObserver(canvasView)
            canvasView.becomeFirstResponder()
            toolPicker = picker
        }
    }

    @objc private func clearTapped() {
        canvasView.drawing = PKDrawing()
    }

    @objc private func cancelTapped() {
        onCancel?()
    }

    @objc private func finishTapped() {
        let renderer = UIGraphicsImageRenderer(bounds: view.bounds)
        let image = renderer.image { _ in
            view.drawHierarchy(in: view.bounds, afterScreenUpdates: true)
        }
        onFinish?(image)
    }
}

// Karierter Hintergrund, passend zum Look des Web-Canvas (siehe style.css: --grid-size: 25px).
class GridBackgroundView: UIView {
    override func draw(_ rect: CGRect) {
        guard let ctx = UIGraphicsGetCurrentContext() else { return }
        UIColor.white.setFill()
        ctx.fill(rect)

        ctx.setStrokeColor(UIColor(red: 0.81, green: 0.88, blue: 0.96, alpha: 1).cgColor)
        ctx.setLineWidth(1)
        let gridSize: CGFloat = 25

        var x: CGFloat = 0
        while x < rect.width {
            ctx.move(to: CGPoint(x: x, y: 0))
            ctx.addLine(to: CGPoint(x: x, y: rect.height))
            x += gridSize
        }
        var y: CGFloat = 0
        while y < rect.height {
            ctx.move(to: CGPoint(x: 0, y: y))
            ctx.addLine(to: CGPoint(x: rect.width, y: y))
            y += gridSize
        }
        ctx.strokePath()
    }
}
