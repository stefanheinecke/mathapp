// Zentrale Aufgaben-Datenbank fuer den Prototyp.
// Jede Aufgabe hat ein Jahr (Pruefungsjahrgang), eine Kategorie und maximale Punktzahl.
// "latex" ist die Aufgabenstellung in KaTeX-Schreibweise fuers Frontend (Bruchstriche, Wurzeln, ...).
// "text" ist optional: wird sie weggelassen, wird sie automatisch (grob) aus "latex" abgeleitet.
// Sie wird trotzdem verwendet fuer die Dropdown-Liste (dort kann kein LaTeX gerendert werden) und
// als Aufgabentext im Prompt an das Bewertungsmodell.
// "images" ist eine optionale Liste von Bildpfaden (z.B. Geometriefiguren), die unter dem
// Aufgabentext angezeigt werden. Dateien gehoeren nach server/public/images/, referenziert als
// "/images/dateiname.png".
// Die Musterloesung ("answer") bleibt serverseitig und wird nie an den Client geschickt.
const RAW_PROBLEMS = [
  {
    id: "2026-1a1",
    latex: "\\text{Vereinfache die Terme soweit wie möglich: } \\dfrac{3x}{4}\\cdot\\dfrac{2}{9}:\\dfrac{x}{2}",
    answer: "1/3 (für x ≠ 0)",
    gradingCriteria:
      "Die Aufgabe verlangt das Vereinfachen des Terms (3x/4) · (2/9) : (x/2), nicht das Loesen einer Gleichung nach x. " +
      "Das Endergebnis 1/3 ist korrekt; x kuerzt sich heraus. Der urspruengliche Term ist fuer x = 0 nicht definiert.",
    year: 2026,
    category: "Gleichung",
    points: 1,
    hints: [
      "Ersetze die Division durch eine Multiplikation mit dem Kehrwert des letzten Bruchs.",
      "Kürze wo möglich, bevor du die Brüche miteinander multiplizierst.",
      "Rechne zuerst die Zahlenbrüche zusammen und behandle x separat.",
    ],
  },
  {
    id: "2026-1a2",
    latex: "\\text{Vereinfache die Terme soweit wie möglich: } 8xy - 6x^2y : (3x)",
    answer: "6xy",
    gradingCriteria:
      "Division bindet vor der Subtraktion: 8xy - (6x^2y)/(3x). Dabei kuerzt sich x^2/x zu x, " +
      "also ist (6x^2y)/(3x) = 2xy und der Term wird 8xy - 2xy = 6xy. " +
      "Die Umformung 8xy - 2xy ist korrekt und darf nicht als 8xy - 2x^2y bewertet werden.",
    year: 2026,
    category: "Termumformung",
    points: 1,
    hints: [
      "Die Division bindet stärker als die Subtraktion – rechne zuerst 6x²y : (3x).",
      "Kürze 6 durch 3 und x² durch x einzeln.",
      "Nach dem Kürzen bleibt 2xy übrig – ziehe das von 8xy ab.",
    ],
  },
  {
    id: "2026-1b",
    latex: "\\text{Dividiere die 2. Potenz von } 12 \\text{ durch die 3. Potenz von } 2.",
    answer: "36a^2 - a (für a ≥ 0)",
    gradingCriteria:
      "Die Wurzeln √(64a^2), √(3a) und √(27a) sind fuer reelle Werte nur gemeinsam fuer a ≥ 0 definiert. " +
      "Daher gilt √(64a^2) = 8a und √(3a)·√(27a) = √(81a^2) = 9a. Ausserdem ist (−6a)^2 = 36a^2. " +
      "Somit: 8a + 36a^2 − 9a = 36a^2 − a. Dieser Rechenweg und dieses Endergebnis sind korrekt.",
    year: 2026,
    category: "Termumformung",
    points: 1,
    hints: ["Berechne zuerst 12² und 2³ einzeln.", "12² = 144 und 2³ = 8.", "Teile 144 durch 8."],
  },
  {
    id: "2026-1c",
    latex:
      "\\text{Bestimme den Term, von dem man } 4x-3 \\text{ subtrahieren muss, um } -x+2 \\text{ zu erhalten.}",
    answer: "3x-1",
    year: 2026,
    category: "Termumformung",
    points: 1,
    hints: [
      "Gesucht ist ein Term T, für den gilt: T − (4x − 3) = −x + 2.",
      "Forme die Gleichung nach T um: T = −x + 2 + (4x − 3).",
      "Fasse die x-Terme und die Zahlen getrennt zusammen.",
    ],
  },
  {
    id: "2026-1d",
    latex: "\\text{Löse die Gleichung nach x auf: } 2y = \\dfrac{ax-1}{3} \\quad (a \\ne 0)",
    answer: "x = (6*y + 1)/a, assuming a != 0",
    year: 2026,
    category: "Gleichung",
    points: 1,
    hints: [
      "Multipliziere zuerst beide Seiten mit 3, um den Bruch zu entfernen.",
      "Danach steht da 6y = ax − 1. Bringe die −1 auf die andere Seite.",
      "Zum Schluss musst du beide Seiten durch a teilen, um x zu isolieren.",
    ],
  },
  {
    id: "2026-1e",
    text: "Das linke Zahnrad im Bild hat 10 Zähne. Das rechte Zahnrad hat 12 Zähne. Berechne, wie oft sich das linke Zahnrad drehen muss, bis beide Zahnräder zum ersten Mal wieder in der unten abgebildeten Position sind.",
    latex: "\\text{Das linke Zahnrad im Bild hat 10 Zähne. Das rechte Zahnrad hat 12 Zähne. Berechne, wie oft sich das linke Zahnrad drehen muss, bis beide Zahnräder zum ersten Mal wieder in der unten abgebildeten Position sind.}",
    images: ["/images/problem-2026-1e.png"],
    answer: "6",
    year: 2026,
    category: "Textaufgabe",
    points: 1,
    hints: [
      "Gesucht ist das kleinste gemeinsame Vielfache (kgV) der beiden Zähnezahlen 10 und 12.",
      "Zerlege 10 und 12 in Primfaktoren, um das kgV zu bestimmen.",
      "Das kgV von 10 und 12 ist 60. Teile 60 durch die Zähnezahl des linken Zahnrads.",
    ],
  },
  {
    id: "2026-1f",
    latex: "\\text{Wandle in ml um: } 2.3 dm^3",
    answer: "2300 ml",
    year: 2026,
    category: "Grössenumrechnungen",
    points: 1,
    hints: ["1 dm³ entspricht 1 Liter.", "1 Liter sind 1000 ml.", "Multipliziere 2.3 mit 1000."],
  },
  {
    id: "2026-1g",
    text: "Berechne x:",
    images: ["/images/problem-2026-1g.png"],
    answer: "x = √72 = 6√2 ≈ 8.485",
    year: 2026,
    category: "Geometrie",
    points: 1,    hints: [
      "Überlege, ob du den Satz des Pythagoras anwenden kannst.",
      "Bestimme zuerst die Quadrate der gegebenen Seitenlängen.",
      "x ist die Wurzel aus der Summe bzw. Differenz der Quadrate – vereinfache die Wurzel so weit wie möglich.",
    ],  },
    {
    id: "2026-1h",
    latex: "\\text{Das Volumen der Pyramide beträgt 7296 m^3. Berechne die Höhe h: }",
    images: ["/images/problem-2026-1h.png"],
    answer: "h = 38 = 38m",
    year: 2026,
    category: "Geometrie",
    points: 1,
    hints: [
      "Die Grundfläche der Pyramide ist ein Rechteck mit den Seiten 48 m und 12 m – berechne zuerst diese Fläche.",
      "Für das Volumen einer Pyramide gilt: V = (1/3) · Grundfläche · Höhe.",
      "Setze das gegebene Volumen (7296 m³) und die berechnete Grundfläche ein und löse nach h auf.",
    ],
    },
    {
    id: "2026-1i",
    text: "Von einem Drachenviereck ABCD (siehe Skizze) ist unten die Diagonale BD bereits vorgegeben. Ausserdem kennt man AB = 4 cm sowie AC = 10 cm. Konstruiere das Drachenviereck ABCD.",
    latex: "\\text{Von einem Drachenviereck ABCD (siehe Skizze) ist unten die Diagonale BD bereits vorgegeben. Ausserdem kennt man AB = 4 cm sowie AC = 10 cm. Konstruiere das Drachenviereck ABCD.}",
    images: ["/images/problem-2026-1i1.png", "/images/problem-2026-1i2.png"],
    answer: "Drachenviereck ABCD, symmetrisch zur Diagonale AC (Mittelsenkrechte von BD), mit AB = 4 cm und AC = 10 cm.",
    year: 2026,
    category: "Geometrie",
    points: 1,
    // Konstruktionsaufgabe statt Rechenaufgabe: kein OCR/Algebra-Check, sondern ein Vision-Modell
    // beurteilt das gezeichnete Bild direkt anhand dieser Bewertungsanleitung (0 oder 1 Punkt).
    gradingType: "construction",
    gradingCriteria:
      "Es wird entweder 0 oder 1 Punkt vergeben.\n" +
      "Der Punkt wird NUR vergeben, wenn der fuer die Konstruktion der Strecke AB notwendige Kreisbogen " +
      "(Radius 4 cm um B) ersichtlich ist.\n" +
      "Der Punkt wird TROTZDEM vergeben,\n" +
      "- falls die Konstruktion der Mittelsenkrechten/des Kreisbogens fuer die Symmetrieachse AC nicht " +
      "erkennbar ist,\n" +
      "- falls die Konstruktion ungenau ist,\n" +
      "- falls die Ecken A und C nicht oder falsch beschriftet sind,\n" +
      "- falls das Drachenviereck ABCD spiegelverkehrt konstruiert wurde (A und C vertauscht bzw. auf der " +
      "anderen Seite von BD).",
    hints: [
      "Trage zuerst mit dem Zirkel die Strecke AB (4 cm) ab: Schlage dazu einen Kreisbogen mit Radius 4 cm um B.",
      "Der Punkt A liegt zugleich auf der Mittelsenkrechten von BD (da ABCD ein Drachenviereck mit AC als Symmetrieachse ist) – schneide diese mit dem Kreisbogen.",
      "Trage anschliessend ab A die Strecke AC (10 cm) auf derselben Mittelsenkrechten ab, um den Punkt C auf der anderen Seite von BD zu finden.",
    ],
    },
    {
    id: "2026-2a",
    latex: "\\text{Löse die Gleichungen nach x auf: } 5−(5x−12) = 10−2(4x+1)",
    answer: "𝑥=−3",
    year: 2026,
    category: "Gleichung",
    points: 2,
    hints: [
      "Löse zuerst die Klammern auf beiden Seiten auf (Vorzeichen beachten!).",
      "Fasse auf jeder Seite die Zahlen und die x-Terme zusammen.",
      "Bringe alle x-Terme auf eine Seite und die Zahlen auf die andere, dann löse nach x auf.",
    ],
  },
  {
    id: "2026-2b",
    latex: "\\text{Löse die Gleichungen nach x auf: }  \\dfrac{5x+3}{4}-\\dfrac{2−9x}{5} = 3x",
    answer: "𝑥=−7",
    year: 2026,
    category: "Gleichung",
    points: 2,
    hints: [
      "Multipliziere beide Seiten mit dem Hauptnenner (hier 20), um die Brüche zu beseitigen.",
      "Achte beim Auflösen der Klammern auf die Vorzeichen, besonders beim zweiten Bruch.",
      "Fasse die x-Terme zusammen und löse die entstehende lineare Gleichung nach x auf.",
    ],
  },
  {
    id: "2026-3a",
    latex: "\\text{Vereinfache die Terme so weit wie möglich: }  \\dfrac{xy}{4}+\\dfrac{3x^2}{4}:\\dfrac{9xy}{16y^2}",
    answer: "19xy/12",
    year: 2026,
    category: "Gleichung",
    points: 2,
    hints: [
      "Die Division bindet stärker als die Addition – rechne zuerst (3x²/4) : (9xy/16y²).",
      "Ersetze die Division durch eine Multiplikation mit dem Kehrwert des zweiten Bruchs.",
      "Kürze wo möglich und bringe danach beide Summanden auf den gleichen Nenner.",
    ],
  },
  {
    id: "2026-3b",
    latex: "\\text{Vereinfache die Terme so weit wie möglich: }  √(64a^2+(−6a)^2)−√3a\\cdot√27a",
    answer: "a",
    year: 2026,
    category: "Gleichung",
    points: 2,
    hints: [
      "Vereinfache zuerst jede Wurzel bzw. jede Potenz einzeln, bevor du addierst oder subtrahierst.",
      "Beachte: √(a²) = |a|, und für die Multiplikation von Wurzeln gilt √a · √b = √(a·b).",
      "Fasse am Schluss alle gleichartigen Terme zusammen.",
    ],
  },
  {
    id: "2026-4a",
    latex: "\\text{Im Folgenden werden drei verschiedene Situationen beschrieben. Stelle jeweils eine Gleichung mit der Unbekannten x auf, welche die Situation des Textes beschreibt. Ausser x darf keine weitere Unbekannte in der Gleichung vorkommen. Die Gleichungen sollen nicht gelöst und auch nicht vereinfacht werden! \n\n Der Eintritt in einen Vergnügungspark kostet für Erwachsene CHF 32 und für Kinder CHF 18. Eine Reisegruppe mit 45 Personen bezahlt insgesamt CHF 1034 für den Eintritt. Gesucht ist die Anzahl Erwachsener der Reisegruppe. \n\n x = Anzahl Erwachsener der Reisegruppe }",
    answer: "32x+18(45-x) =1034",
    year: 2026,
    category: "Gleichung",
    points: 1,
    hints: [
      "Wenn x die Anzahl Erwachsener ist, wie viele Kinder sind es dann (insgesamt 45 Personen)?",
      "Multipliziere die Anzahl Erwachsener mit CHF 32 und die Anzahl Kinder mit CHF 18.",
      "Die Summe dieser beiden Beträge muss CHF 1034 ergeben – das ist deine Gleichung.",
    ],
  },
  {
    id: "2026-4b",
    latex: "\\text{Im Folgenden werden drei verschiedene Situationen beschrieben. Stelle jeweils eine Gleichung mit der Unbekannten x auf, welche die Situation des Textes beschreibt. Ausser x darf keine weitere Unbekannte in der Gleichung vorkommen. Die Gleichungen sollen nicht gelöst und auch nicht vereinfacht werden! \n\n Alina hat 5-mal so viel Geld wie Mia. Alina gibt CHF 600 aus, Mia gibt CHF 150 aus. Jetzt haben beide zusammen 3-mal so viel Geld wie Mia zu Beginn hatte. Gesucht ist Mias Geld in CHF zu Beginn. \n\n x = Mias Geld in CHF zu Beginn }",
    answer: "5x-600+x-150=3x",
    year: 2026,
    category: "Gleichung",
    points: 1,
    hints: [
      "Wenn x Mias Geld zu Beginn ist, wie viel hatte Alina zu Beginn (5-mal so viel)?",
      "Ziehe von jedem der beiden Beträge das jeweils Ausgegebene ab, um ihr aktuelles Geld zu erhalten.",
      "Die Summe des aktuellen Geldes beider zusammen muss 3x ergeben – das ist deine Gleichung.",
    ],
  },
  {
    id: "2026-4c",
    latex: "\\text{Im Folgenden werden drei verschiedene Situationen beschrieben. Stelle jeweils eine Gleichung mit der Unbekannten x auf, welche die Situation des Textes beschreibt. Ausser x darf keine weitere Unbekannte in der Gleichung vorkommen. Die Gleichungen sollen nicht gelöst und auch nicht vereinfacht werden! \n\n Gesucht ist eine Zahl. Die Hälfte vom Dreifachen der um 8 verkleinerten Zahl ist um 2 grösser als das Fünfache der Zahl. \n\n x = gesuchte Zahl }",
    answer: "3(x-8)/2=5x+2",
    year: 2026,
    category: "Gleichung",
    points: 1,
    hints: [
      "'Die um 8 verkleinerte Zahl' bedeutet (x − 8).",
      "'Das Dreifache davon' ist 3·(x − 8), und 'die Hälfte davon' ist 3(x−8)/2.",
      "'Um 2 grösser als das Fünffache der Zahl' bedeutet, dass der linke Ausdruck gleich 5x + 2 sein muss.",
    ],
  },
  {
    id: "2026-5a",
    latex: "\\text{Die Gemeinde Rist besteht aus den Dörfern Unterrist und Oberrist.\nBei einer Abstimmung an einer Gemeindeversammlung haben alle Anwesenden entweder mit Ja oder mit Nein gestimmt.\nDie obere Grafik zeigt die Aufteilung der Anwesenden auf die beiden Dörfer der Gemeinde.\nDie unteren Grafiken zeigen die Abstimmungsresultate der beiden Dörfer.\n54 Anwesende aus Oberrist stimmten Ja.\nBerechne, wieviele Anwesende aus Unterrist Nein stimmten.}",
    answer: "21",
    year: 2026,
    images: ["/images/problem-2026-5a.png"],
    category: "Textaufgabe",
    points: 2,
    hints: [
      "Nutze zuerst das Verhältnis bei Oberrist (3/4 Ja), um aus den 54 Ja-Stimmen die Gesamtzahl der Anwesenden aus Oberrist zu berechnen.",
      "Die Anzahl Anwesender aus Oberrist entspricht 60% aller Anwesenden – berechne daraus die Gesamtzahl aller Anwesenden und davon die Anzahl aus Unterrist (40%).",
      "Wende auf die Anwesenden aus Unterrist den Nein-Anteil (43.75%) an, um die gesuchte Anzahl zu erhalten.",
    ],
  },
  {
    id: "2026-5b",
    latex: "\\text{Valeria hat 9% ihres Taschengeldes ausgegeben. Dies entspricht 7.5% der CHF 84, die Jan als Taschengeld erhält.\nBerechne das Taschengeld von Valeria.}",
    answer: "CHF 70 = 70 CHF",
    year: 2026,
    category: "Textaufgabe",
    points: 1,
    hints: [
      "Berechne zuerst 7.5% von CHF 84 – das entspricht Valerias 9%.",
      "Du weisst nun: 9% von Valerias Taschengeld entsprechen diesem berechneten Betrag.",
      "Teile diesen Betrag durch 0.09, um Valerias volles Taschengeld zu erhalten.",
    ],
  },
  {
    id: "2026-6",
    text: "Unten sind Längsschnitte von vier prismenförmigen Gefässen abgebildet. Alle Gefässe sind am Anfang leer. Dann werden sie mit konstantem Zufluss gefüllt. Ein Füllgraph gibt die Füllhöhe im Gefäss in Abhängigkeit der Zeit an. Ordne jedem Gefäss den passenden Füllgraphen zu.",
    answer: "1-F, 2-D, 3-A, 4-B",
    year: 2026,
    images: ["/images/problem-2026-6.png"],
    category: "Textaufgabe",
    points: 2,
    hints: [
      "Ein Gefäss mit gleichbleibendem Querschnitt (z.B. ein Zylinder) füllt sich mit konstanter Geschwindigkeit – das ergibt eine Gerade im Füllgraphen.",
      "Wird das Gefäss nach oben schmaler, steigt die Füllhöhe pro Zeiteinheit immer schneller (die Kurve wird steiler); wird es nach oben breiter, steigt sie immer langsamer.",
      "Achte auf Gefässe mit mehreren Abschnitten (z.B. erst schmal, dann breit, dann wieder schmal) – solche Gefässe erzeugen Füllgraphen mit mehreren Knicken bzw. Wendepunkten.",
    ],
    },
    {
    id: "2026-7a",
    latex: "\\text{Samira und Nora spielen Basketball.\n\nSamira trifft den Korb erfahrungsgemäss in zwei von drei Würfen.\n\nNora trifft den Korb erfahrungsgemäss in drei von fünf Würfen.\n\nBeide dürfen je einen Freiwurf werfen. Berechne die Wahrscheinlichkeit, dass mindestens jemand von den beiden den Korb trifft.}",
    answer: "13/15 = 0.86 ≈ 86.7%",
    year: 2026,
    category: "Textaufgabe",
    points: 2,
    hints: [
      "'Mindestens einer trifft' lässt sich einfacher über das Gegenereignis berechnen: 'Beide verfehlen'.",
      "Berechne zuerst die Wahrscheinlichkeit, dass Samira verfehlt (1 − 2/3) und dass Nora verfehlt (1 − 3/5).",
      "Multipliziere diese beiden Wahrscheinlichkeiten und ziehe das Ergebnis von 1 ab.",
    ],
    },
    {
    id: "2026-7b",
    latex: "\\text{Fabian und Lenny dürfen für ihr Basketballteam je einen Freiwurf werfen.\n\nFabian trifft den Korb erfahrungsgemäss in drei von vier Würfen.\n\nDie Wahrscheinlichkeit, dass beide den Korb treffen, beträgt 30%.\n\nBerechne Lennys Trefferwahrscheinlichkeit.}",
    answer: "2/5 = 0.4 ≈ 40%",
    year: 2026,
    category: "Textaufgabe",
    points: 1,
    hints: [
      "Wenn zwei unabhängige Ereignisse beide eintreten sollen, multipliziert man ihre Wahrscheinlichkeiten.",
      "Du kennst P(Fabian trifft) = 3/4 und P(beide treffen) = 30% = 0.3.",
      "Teile die Wahrscheinlichkeit 'beide treffen' durch Fabians Trefferwahrscheinlichkeit, um Lennys Wahrscheinlichkeit zu erhalten.",
    ],
    },
    {
    id: "2026-8",
    latex: "\\text{Der grau eingefärbte Teil des Rechtecks ABCD hat einen Flächeninhalt von} 154 cm^2. \\text{Berechne x.\n\n(Die Abbildung ist nicht massstabsgetreu.)}",
    answer: "x=3.5cm",
    images: ["/images/problem-2026-8.png"],
    year: 2026,
    category: "Geometrie",
    points: 3,
    hints: [
      "Berechne zuerst den Gesamtflächeninhalt des Rechtecks ABCD (die Breite ergibt sich als Summe 3x+x+x+2x = 7x).",
      "Berechne die Flächeninhalte der beiden weiss dargestellten Dreiecke einzeln (Grundseite mal Höhe geteilt durch 2, Höhe jeweils 8 cm).",
      "Der graue Flächeninhalt ist die Rechtecksfläche minus die beiden Dreiecksflächen. Setze das gleich 154 cm² und löse nach x auf.",
    ],
    },
    {
    id: "2026-9a",
    latex: "\\text{Vier Stangen stehen senkrecht auf einer Ebene. Je zwei Stangen sind gleich lang. Die vier Stangen bilden das Gerüst eines Zeltes, das in der Abbildung grau dargestellt ist. Der Boden des Zeltes ist ein Rechteck.\n\nBerechne die Länge der Strecke x.}",
    answer: "x=7.25m",
    images: ["/images/problem-2026-9a.png"],
    year: 2026,
    category: "Geometrie",
    points: 1,
    hints: [
      "Die Strecke x bildet mit der Höhendifferenz der beiden Stangen und ihrem horizontalen Abstand ein rechtwinkliges Dreieck.",
      "Die Höhendifferenz der beiden Stangen beträgt 8 m − 2.75 m = 5.25 m. Lies aus dem Gitter (1 m pro Kästchen) den horizontalen Abstand zwischen den beiden Stangen ab.",
      "Wende den Satz des Pythagoras an: x = √(Höhendifferenz² + horizontaler Abstand²).",
    ],
    },
    {
    id: "2026-9b",
    latex: "\\text{Berechne das Volumen des Zeltes.}",
    answer: "x=268.75m^3",
    images: ["/images/problem-2026-9a.png"],
    year: 2026,
    category: "Geometrie",
    points: 2,
    hints: [
      "Der Zeltkörper lässt sich als Prisma mit trapezförmiger Querschnittsfläche auffassen: Berechne zuerst die Fläche dieses Trapezes (Parallelseiten 2.75 m und 8 m).",
      "Das Volumen = mittlere Höhe (Durchschnitt der beiden Stangenlängen) mal Grundfläche (Länge mal Breite des rechteckigen Bodens).",
      "Lies Länge und Breite des rechteckigen Bodens aus dem Gitter ab (1 m pro Kästchen) und setze alle Werte in die Volumenformel ein.",
    ],
    },
    {
    id: "2026-10a",
    latex: "\\text{Unten siehst du eine Abfolge von Figuren. Sie beginnt mit einem gleichseitigen Dreieck. Danach wird bei jeder Seite ein gleichseitiger Zacken angesetzt. Alle Strecken einer Figur sind jeweils gleich lang. Dieser Vorgang wird laufend wiederholt.\n\nBerechne die Anzahl Strecken der Figur Nummer 4. Du kannst zur Hilfe die folgende Tabelle benützen.}",
    answer: "768",
    images: ["/images/problem-2026-10a.png"],
    year: 2026,
    category: "Geometrie",
    points: 1,
    hints: [
      "Zähle, wie viele Strecken die Ausgangsfigur (das Dreieck) hat, und überlege, was bei jedem Schritt mit JEDER einzelnen Strecke passiert.",
      "Jede Strecke wird durch einen Zacken ersetzt – dabei entstehen aus einer Strecke jeweils 4 neue Strecken.",
      "Die Anzahl Strecken vervierfacht sich also bei jedem Schritt. Nutze die Tabelle, um von Figur zu Figur hochzuzählen bis Figur Nummer 4.",
    ],
    },
    {
    id: "2026-10b",
    latex: "\\text{Erstelle einen Term, mit dem man die Anzahl Strecken der Figur Nummer n berechnen kann. (n steht für die Nummer einer beliebigen Figur der Abfolge.)}",
    answer: "3*4^n=3*2^(2n)",
    images: ["/images/problem-2026-10a.png"],
    year: 2026,
    category: "Geometrie",
    points: 1,
    hints: [
      "Du hast in der Tabelle gesehen, dass sich die Streckenzahl bei jedem Schritt vervierfacht (mal 4).",
      "Das bedeutet, die Streckenzahl folgt einer Potenz von 4, multipliziert mit der Streckenzahl der Ausgangsfigur (3).",
      "Stelle einen Term der Form 3 · 4^n auf, wobei n die Figurnummer ist.",
    ],
    },
];

// Grobe, nicht perfekte Rueckuebersetzung von KaTeX-Quelltext in lesbaren Klartext.
// Reicht fuer Dropdown-Beschriftungen und den Bewertungs-Prompt; deckt nur die in diesem
// Prototyp verwendeten Befehle ab (\text, \dfrac/\frac, \sqrt, \cdot, \div, ^{...}).
function deriveTextFromLatex(latex) {
  let s = latex;
  for (let i = 0; i < 3; i++) {
    s = s
      .replace(/\\d?frac\{([^{}]*)\}\{([^{}]*)\}/g, "($1)/($2)")
      .replace(/\\sqrt\{([^{}]*)\}/g, "sqrt($1)")
      .replace(/\^\{([^{}]*)\}/g, "^$1");
  }
  return s
    .replace(/\\text\{([^{}]*)\}/g, "$1")
    .replace(/\\cdot/g, "*")
    .replace(/\\div/g, ":")
    .replace(/\\left|\\right/g, "")
    .replace(/[{}]/g, "")
    .replace(/\\,/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const PROBLEMS = RAW_PROBLEMS.map((p) => ({
  ...p,
  // Fehlen text UND latex, gaebe es sonst einen Absturz beim Serverstart (siehe deriveTextFromLatex).
  text: p.text ?? (p.latex ? deriveTextFromLatex(p.latex) : ""),
  images: p.images ?? [],
  hints: p.hints ?? [],
}));

export function findProblem(id) {
  return PROBLEMS.find((p) => p.id === id);
}

export function filterProblems({ year, category } = {}) {
  return PROBLEMS.filter((p) => {
    if (year !== undefined && String(p.year) !== String(year)) return false;
    if (category !== undefined && p.category !== category) return false;
    return true;
  });
}

export function listYears() {
  return [...new Set(PROBLEMS.map((p) => p.year))].sort((a, b) => a - b);
}

export function listCategories() {
  return [...new Set(PROBLEMS.map((p) => p.category))].sort((a, b) => a.localeCompare(b, "de"));
}
