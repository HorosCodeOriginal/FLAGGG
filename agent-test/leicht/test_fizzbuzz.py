import unittest

from fizzbuzz import fizzbuzz


class TestFizzBuzz(unittest.TestCase):

    def test_n_equals_1(self):
        self.assertEqual(fizzbuzz(1), ["1"])

    def test_n_equals_3(self):
        self.assertEqual(fizzbuzz(3), ["1", "2", "Fizz"])

    def test_n_equals_5(self):
        self.assertEqual(fizzbuzz(5), ["1", "2", "Fizz", "4", "Buzz"])

    def test_n_equals_15(self):
        expected = [
            "1", "2", "Fizz", "4", "Buzz", "Fizz",
            "7", "8", "Fizz", "Buzz", "11", "Fizz",
            "13", "14", "FizzBuzz",
        ]
        self.assertEqual(fizzbuzz(15), expected)

    def test_n_equals_100(self):
        result = fizzbuzz(100)
        self.assertEqual(len(result), 100)
        self.assertEqual(result[14], "FizzBuzz")   # 15
        self.assertEqual(result[29], "FizzBuzz")   # 30
        self.assertEqual(result[44], "FizzBuzz")   # 45
        self.assertEqual(result[59], "FizzBuzz")   # 60
        self.assertEqual(result[74], "FizzBuzz")   # 75
        self.assertEqual(result[89], "FizzBuzz")   # 90
        self.assertEqual(result[99], "Buzz")       # 100
        self.assertEqual(result[2], "Fizz")        # 3
        self.assertEqual(result[4], "Buzz")        # 5


if __name__ == "__main__":
    unittest.main()
