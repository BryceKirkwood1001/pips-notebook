# Binary Search

CS 201 lecture notes, week 3. All code is Python. Lists use zero-based indexes.

## 1. The search range and the midpoint

Binary search finds a target value in a sorted list. Binary search only works when the list is sorted. If the list is not sorted, the result can be wrong even when the target is in the list.

The algorithm keeps a search range between two indexes, lo and hi. The target, if it is present, is always inside the range from lo to hi. This statement is called the invariant, and every step of the algorithm must keep it true.

Each step looks at the middle element of the range. The midpoint is computed with integer division:

```python
mid = (lo + hi) // 2
```

Integer division rounds down, so when the range has an even number of elements the midpoint is the left one of the two middle elements. For lo = 0 and hi = 7, the midpoint is (0 + 7) // 2 = 3.

The step then compares the middle element with the target. If the middle element equals the target, the search returns mid. If the middle element is smaller than the target, the target can only be to the right, so the search continues in the right half. If the middle element is larger than the target, the search continues in the left half.

Binary search returns the index of the target, not the target itself. When the target is not in the list, this version returns -1.

```python
def binary_search(items, target):
    lo = 0
    hi = len(items) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if items[mid] == target:
            return mid
        elif items[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1
```

### Worked example 1.1

Trace binary_search([2, 5, 8, 12, 16, 23, 38], 23).

Solution: Start with lo = 0 and hi = 6. First step: mid = 3 and items[3] = 12, which is smaller than 23, so lo becomes 4. Second step: mid = (4 + 6) // 2 = 5 and items[5] = 23, which equals the target. The function returns 5.

### Practice problems 1

1. For lo = 2 and hi = 9, what is mid? Answer: 5

2. True or false: Binary search gives correct results on any list, sorted or not. Answer: False

3. What does binary_search([1, 3, 5, 7, 9], 7) return? Answer: 3

4. What does binary_search([1, 3, 5, 7, 9], 4) return? Answer: -1

5. In binary_search([10, 20, 30, 40, 50, 60, 70, 80], 20), what is the first value of mid?
   - A. 4
   - B. 3
   - C. 40
   - D. 3.5

   Answer: B

6. The middle element is smaller than the target. Which part of the range does the search keep?
   - A. The left half
   - B. The right half
   - C. Both halves
   - D. Only the middle element

   Answer: B

## 2. Loop bounds and off-by-one errors

Most binary search bugs are off-by-one errors in the loop condition or in the range updates.

The loop condition is lo <= hi. When lo equals hi the range still holds one element, and that element must be checked. A loop that uses lo < hi stops one step too early and can miss a target that sits in the last remaining position.

The updates must exclude the middle element, because it has already been checked. The right half starts at mid + 1 and the left half ends at mid - 1. Writing lo = mid instead of lo = mid + 1 can cause an infinite loop: when lo and hi are next to each other, mid equals lo, so the range never gets smaller.

The search ends in one of two ways. It returns mid when the target is found, or the loop ends when lo becomes greater than hi, which means the range is empty and the target is not in the list.

In languages with fixed-size integers, lo + hi can overflow for very large lists. The safe form is mid = lo + (hi - lo) // 2, which gives the same result without the large sum. Python integers do not overflow, but the safe form is still a good habit.

### Worked example 2.1

Trace binary_search([4, 9, 15], 15) and list every value of lo, hi and mid.

Solution: Start with lo = 0 and hi = 2. First step: mid = 1 and items[1] = 9, which is smaller than 15, so lo becomes 2. Now lo = 2 and hi = 2, and the condition lo <= hi is still true. Second step: mid = 2 and items[2] = 15, so the function returns 2. With the condition lo < hi the loop would have stopped before the second step and returned -1.

### Practice problems 2

1. Which loop condition is correct for the version of binary search in these notes?
   - A. while lo < hi
   - B. while lo <= hi
   - C. while lo != hi
   - D. while mid < hi

   Answer: B

2. The middle element is smaller than the target. What is the correct update?
   - A. lo = mid
   - B. hi = mid - 1
   - C. lo = mid + 1
   - D. hi = mid + 1

   Answer: C

3. True or false: When lo equals hi, the search range is empty. Answer: False

4. A programmer changes lo = mid + 1 to lo = mid. With lo = 3 and hi = 4, and a target larger than items[3], what is the next value of lo? Answer: 3

5. How many times does the loop body run in binary_search([4, 9, 15], 15)? Answer: 2

6. Put the steps of one loop pass in order: compare items[mid] with the target, compute mid, update lo or hi, check that lo <= hi. Answer: check that lo <= hi, compute mid, compare items[mid] with the target, update lo or hi

7. For lo = 6 and hi = 9, what does lo + (hi - lo) // 2 give? Answer: 7

## 3. Running time

Each step of binary search cuts the search range in half. Because the range is halved at every step, the number of steps grows with the logarithm of the list size, so binary search runs in O(log n) time.

In the worst case, binary search on a list of n elements makes floor(log2(n)) + 1 comparisons of the middle element. For a list of 1000 elements that is 10 comparisons, because floor(log2(1000)) = 9.

Doubling the size of the list adds only one more step in the worst case. A list of 1,000,000 elements needs at most 20 comparisons, while a list of 2,000,000 elements needs at most 21.

Linear search checks the elements one by one and runs in O(n) time. On a list of 1,000,000 elements, linear search may need 1,000,000 comparisons where binary search needs at most 20.

The best case for binary search is 1 comparison, when the target is the first middle element. The speed has a price: the list must be sorted first, and sorting takes O(n log n) time. For a single search on an unsorted list, linear search is the better choice.

### Worked example 3.1

How many comparisons does binary search need in the worst case on a list of 64 elements?

Solution: log2(64) = 6, so floor(log2(64)) + 1 = 6 + 1 = 7. The worst case is 7 comparisons.

### Practice problems 3

1. What is the worst-case running time of binary search?
   - A. O(1)
   - B. O(log n)
   - C. O(n)
   - D. O(n log n)

   Answer: B

2. What is the worst-case number of comparisons for a list of 16 elements? Answer: 5

3. A list grows from 1,000,000 to 2,000,000 elements. How many more comparisons does binary search need in the worst case? Answer: 1

4. True or false: Binary search always needs at least log2(n) comparisons. Answer: False

5. What is the worst-case number of comparisons for a list of 1000 elements? Answer: 10

6. You need to search an unsorted list exactly once. Which is the better choice: linear search, or sorting and then binary search? Answer: linear search

## Common mistakes

> **Common mistake:** "Binary search works on any list." Wrong. Binary search only works when the list is sorted.

> **Common mistake:** "Binary search returns the value it found." Wrong. Binary search returns the index of the target, not the target itself.

> **Common mistake:** "The loop should be while lo < hi." Wrong. When lo equals hi the range still holds one element, and that element must be checked.

> **Common mistake:** "After checking the middle, set lo = mid." Wrong. The updates must exclude the middle element, because it has already been checked.

> **Common mistake:** "Binary search is O(n) because in the worst case it looks at every element." Wrong. Each step of binary search cuts the search range in half.

> **Common mistake:** "A list twice as big takes twice as many steps." Wrong. Doubling the size of the list adds only one more step in the worst case.
