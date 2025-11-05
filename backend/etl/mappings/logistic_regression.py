# logistic_regression.py
import sys
import json
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score

# Load data from command-line arguments
X_data = json.loads(sys.argv[2])  # Features
y_data = json.loads(sys.argv[4])  # Target

# Convert to numpy arrays
X = np.array(X_data)
y = np.array(y_data)

# Train Logistic Regression model
model = LogisticRegression()
model.fit(X, y)
y_pred = model.predict(X)

# Calculate accuracy
accuracy = accuracy_score(y, y_pred)

# Output results
result = {
    'accuracy': accuracy,
    'predictions': y_pred.tolist()
}
print(json.dumps(result))