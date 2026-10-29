# FizzBuzz (leicht)

## Was gebaut wurde
- `fizzbuzz.py` – Funktion `fizzbuzz(n)` liefert für 1..n eine Liste:
  - `"Fizz"` bei Teilbarkeit durch 3,
  - `"Buzz"` bei Teilbarkeit durch 5,
  - `"FizzBuzz"` bei Teilbarkeit durch 3 und 5,
  - sonst die Zahl als String.
- `test_fizzbuzz.py` – `unittest.TestCase` mit Tests für n = 1, 3, 5, 15, 100.

## Testergebnis
`py -m unittest test_fizzbuzz.py -v` (Python 3.11.9):

```
Ran 5 tests in 0.001s

OK
```

Alle 5 Tests grün, Exit-Code 0.
