# This is a sample Python script.

# Press Shift+F10 to execute it or replace it with your code.
# Press Double Shift to search everywhere for classes, files, tool windows, actions, and settings.
import dotenv
import sys
def print_hi(name):
    # Use a breakpoint in the code line below to debug your script.
    print(f'Hi, {name}')  # Press Ctrl+F8 to toggle the breakpoint.

def print_values(*args ,**kwargs):
    for key in args:
        print(f'{key}')
    for key, value in kwargs.items():
        print(f'{key} = {value}')

def greet(a,b,c):
    print(a)
    print(b)
    print(c)

def squares(n):
    for i in range(n):
        yield i * i


# Press the green button in the gutter to run the script.
if __name__ == '__main__':
    # d = {
    #     'a':1,
    #     'b':2,
    #     'd':'c',
    # }
    #
    # l = [1,2,3]

    nums = (x * x for x in range(10))

    for n in nums:
        print(n)



    g = squares(3)  # 调用函数不执行函数体，只返回一个生成器对象
    print(next(g))  # 0
    next(g)  # 1
    next(g)  # 4


# See PyCharm help at https://www.jetbrains.com/help/pycharm/
