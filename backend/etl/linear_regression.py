# linear_regression.py
import sys
import json
import numpy as np
from sklearn.linear_model import LinearRegression
import matplotlib.pyplot as plt

# Load data from command-line arguments
X_data = json.loads(sys.argv[2])  # Features
y_data = json.loads(sys.argv[4])  # Target

# Convert data to numpy arrays
X = np.array(X_data)
y = np.array(y_data)

# Train model
model = LinearRegression()
model.fit(X, y)
y_pred = model.predict(X)

# MSE and R² Calculation
mse = np.mean((y_pred - y)**2)
r2 = model.score(X, y)

# Plot the results
plt.plot(X, y, label='Actual')
plt.plot(X, y_pred, label='Predicted', linestyle='--')
plt.legend()
plt.savefig("/path/to/save/plot.png")  # Save chart for frontend display

# Output results
result = {
    'r2': r2,
    'mse': mse,
    'predictions': y_pred.tolist(),
    'chart': '/path/to/save/plot.png'  # Send path to chart image for frontend
}
print(json.dumps(result))